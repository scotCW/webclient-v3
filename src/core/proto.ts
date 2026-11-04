// Protobuf encoding for the rendezvous and session protocols.
import protobuf from 'protobufjs'
import rendezvousSchema from '../proto/rendezvous.proto?raw'
import sessionSchema from '../proto/session.proto?raw'

const root = new protobuf.Root()
protobuf.parse(rendezvousSchema, root, { keepCase: true })
protobuf.parse(sessionSchema, root, { keepCase: true })
root.resolveAll()

const RendezvousType = root.lookupType('wire.RendezvousMessage')
const MessageType = root.lookupType('wire.Message')
const IdPkType = root.lookupType('wire.IdPk')

const toObjectOptions: protobuf.IConversionOptions = {
  longs: Number,
  enums: Number,
  defaults: false,
  oneofs: true,
}

// Decoded messages are plain objects keyed by the snake_case field names in
// the .proto files; `union` names the oneof member that is set.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = Record<string, any>

function encode(type: protobuf.Type, value: Msg): Uint8Array {
  return type.encode(type.fromObject(value)).finish()
}

function decode(type: protobuf.Type, bytes: Uint8Array): Msg {
  return type.toObject(type.decode(bytes), toObjectOptions)
}

export const encodeRendezvous = (value: Msg) => encode(RendezvousType, value)
export const decodeRendezvous = (bytes: Uint8Array) => decode(RendezvousType, bytes)
export const encodeMessage = (value: Msg) => encode(MessageType, value)
export const decodeMessage = (bytes: Uint8Array) => decode(MessageType, bytes)
export const decodeIdPk = (bytes: Uint8Array) => decode(IdPkType, bytes) as { id?: string; pk?: Uint8Array }

export const ConnType = { DEFAULT: 0, FILE_TRANSFER: 1, PORT_FORWARD: 2, RDP: 3, VIEW_CAMERA: 4, TERMINAL: 5 } as const
export const NatType = { UNKNOWN: 0, ASYMMETRIC: 1, SYMMETRIC: 2 } as const
export const BoolOption = { NotSet: 0, No: 1, Yes: 2 } as const
export const ImageQuality = { NotSet: 0, Low: 2, Balanced: 3, Best: 4 } as const
export const PreferCodec = { Auto: 0, VP9: 1, H264: 2, H265: 3, VP8: 4, AV1: 5 } as const
export const ClipboardFormat = { Text: 0, Rtf: 1, Html: 2, ImageRgba: 21, ImagePng: 22, ImageSvg: 23 } as const
export const FileType = { Dir: 0, DirLink: 2, DirDrive: 3, File: 4, FileLink: 5 } as const
export const KeyboardMode = { Legacy: 0, Map: 1, Translate: 2, Auto: 3 } as const

/** ControlKey enum values from session.proto, looked up by name. */
export const ControlKey: Record<string, number> = root.lookupEnum('wire.ControlKey').values
export const PunchHoleFailure: Record<string, number> = root.lookupEnum('wire.PunchHoleResponse.Failure').values
