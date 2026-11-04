// Reaching a peer: ask the ID server for a relay session, join the relay, and
// agree on an end-to-end session key with the peer.
import nacl from 'tweetnacl'
import { CLIENT_VERSION, ServerConfig, wsUrl } from './config'
import {
  ConnType,
  NatType,
  PunchHoleFailure,
  decodeIdPk,
  decodeMessage,
  decodeRendezvous,
  encodeMessage,
  encodeRendezvous,
} from './proto'
import { Transport } from './transport'
import { fromBase64 } from './util'

export class ConnectError extends Error {}

export interface PeerLink {
  transport: Transport
  /** whether the session is end-to-end encrypted */
  secure: boolean
  /** peer client version reported by the ID server, if any */
  peerVersion: string
}

type ConnTypeValue = (typeof ConnType)[keyof typeof ConnType]

const FAILURE_TEXT: Record<number, string> = {
  [PunchHoleFailure.ID_NOT_EXIST]: 'ID does not exist',
  [PunchHoleFailure.OFFLINE]: 'Remote desktop is offline',
  [PunchHoleFailure.LICENSE_MISMATCH]: 'Key mismatch: check the server key in Settings',
  [PunchHoleFailure.LICENSE_OVERUSE]: 'Key overuse',
}

export async function connectToPeer(
  server: ServerConfig,
  peerId: string,
  connType: ConnTypeValue,
  token: string,
  onStatus: (text: string) => void,
): Promise<PeerLink> {
  if (!server.idServer) throw new ConnectError('No ID server configured. Open Settings to set one.')

  onStatus('Contacting ID server…')
  const rendezvous = await Transport.open(wsUrl(server.idServer, 'id')).catch((e: Error) => {
    throw new ConnectError(`Cannot reach the ID server: ${e.message}`)
  })
  let relay: { uuid: string; relayServer: string; pk?: Uint8Array; version: string }
  try {
    rendezvous.send(
      encodeRendezvous({
        punch_hole_request: {
          id: peerId,
          nat_type: NatType.SYMMETRIC,
          licence_key: server.key,
          conn_type: connType,
          token,
          version: CLIENT_VERSION,
          force_relay: true,
        },
      }),
    )
    relay = await waitForRelay(rendezvous)
  } finally {
    rendezvous.close()
  }

  onStatus('Connecting to relay…')
  const relayServer = server.relayServer || relay.relayServer || server.idServer
  const transport = await Transport.open(wsUrl(relayServer, 'relay')).catch((e: Error) => {
    throw new ConnectError(`Cannot reach the relay server: ${e.message}`)
  })
  transport.send(
    encodeRendezvous({
      request_relay: {
        id: peerId,
        uuid: relay.uuid,
        licence_key: server.key,
        conn_type: connType,
        token,
      },
    }),
  )

  onStatus('Securing connection…')
  const secure = await secureSession(transport, peerId, server.key, relay.pk)
  return { transport, secure, peerVersion: relay.version }
}

async function waitForRelay(t: Transport) {
  for (;;) {
    const msg = decodeRendezvous(await t.recv(20000).catch(() => {
      throw new ConnectError('The ID server did not answer. The remote device may be offline.')
    }))
    if (msg.union === 'relay_response') {
      const rr = msg.relay_response
      if (rr.refuse_reason) throw new ConnectError(rr.refuse_reason)
      if (!rr.uuid) throw new ConnectError('The ID server returned no relay session')
      return { uuid: rr.uuid as string, relayServer: (rr.relay_server as string) || '', pk: rr.pk as Uint8Array | undefined, version: (rr.version as string) || '' }
    }
    if (msg.union === 'punch_hole_response') {
      const ph = msg.punch_hole_response
      if (ph.other_failure) throw new ConnectError(ph.other_failure)
      throw new ConnectError(FAILURE_TEXT[ph.failure ?? 0] ?? 'Connection refused by the ID server')
    }
  }
}

/**
 * The relay response carries the peer's identity key signed by the server.
 * The peer then sends its session key signed with that identity key; we reply
 * with a fresh symmetric key sealed to it, and both sides switch to secretbox.
 * Without a server key nothing can be verified and the session stays plain.
 */
async function secureSession(t: Transport, peerId: string, serverKey: string, signedIdPk?: Uint8Array): Promise<boolean> {
  let serverPk: Uint8Array | null = null
  try {
    if (serverKey) serverPk = fromBase64(serverKey)
  } catch {
    serverPk = null
  }
  let identityPk: Uint8Array | null = null
  if (serverPk?.length === 32 && signedIdPk?.length) {
    const opened = nacl.sign.open(signedIdPk, serverPk)
    if (opened) {
      const idpk = decodeIdPk(opened)
      if (idpk.id === peerId && idpk.pk?.length === 32) identityPk = idpk.pk
    }
  }
  if (!identityPk) {
    t.send(encodeMessage({}))
    return false
  }

  const first = decodeMessage(await t.recv(20000))
  if (first.union !== 'signed_id') {
    t.send(encodeMessage({}))
    return false
  }
  const opened = nacl.sign.open(first.signed_id.id ?? new Uint8Array(), identityPk)
  const idpk = opened ? decodeIdPk(opened) : null
  if (!idpk || idpk.id !== peerId || idpk.pk?.length !== 32) {
    t.send(encodeMessage({ public_key: {} }))
    return false
  }
  const ours = nacl.box.keyPair()
  const sessionKey = nacl.randomBytes(nacl.secretbox.keyLength)
  const sealed = nacl.box(sessionKey, new Uint8Array(nacl.box.nonceLength), idpk.pk, ours.secretKey)
  t.send(encodeMessage({ public_key: { asymmetric_value: ours.publicKey, symmetric_value: sealed } }))
  t.setKey(sessionKey)
  return true
}
