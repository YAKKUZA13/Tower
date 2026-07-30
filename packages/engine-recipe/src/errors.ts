/**
 * CompileError классы (порт из forge/src/recipe/v3/errors.rs, research §15.2A).
 * compile() собирает ВСЕ ошибки и возвращает их списком (не bail на первой).
 */
export type CompileError =
  | { kind: 'WrongFormatVersion'; found: number }
  | { kind: 'DuplicateId'; id: string }
  | { kind: 'UnknownRef'; id: string; valid: string[] }
  | { kind: 'UnknownAsset'; id: string }
  | { kind: 'MultipleOpeningsOnFace'; volume: string; face: string }
  | { kind: 'OpeningExceedsFace'; volume: string; face: string; detail: string }
  | { kind: 'RotationNotMultipleOf90'; unit: string; value: number }
  | { kind: 'RowCountOutOfRange'; id: string; count: number }
  | { kind: 'ScatterTooManyInstances'; id: string; projected: number }
  | { kind: 'TotalPartsExceeded'; count: number }
  | { kind: 'NonFiniteFloat'; unit: string; field: string }
  | { kind: 'EmptyGroup'; id: string }
  | { kind: 'MirrorOfMirror'; id: string; target: string };

/** Человекочитаемое сообщение (для отладки/логов). */
export function compileErrorMessage(e: CompileError): string {
  switch (e.kind) {
    case 'WrongFormatVersion': return `format_version != 3 (found ${e.found})`;
    case 'DuplicateId': return `duplicate id '${e.id}'`;
    case 'UnknownRef': return `unknown/forward ref '${e.id}' (valid so far: ${e.valid.join(', ') || 'none'})`;
    case 'UnknownAsset': return `unknown asset '${e.id}'`;
    case 'MultipleOpeningsOnFace': return `volume '${e.volume}': >1 opening on face ${e.face}`;
    case 'OpeningExceedsFace': return `volume '${e.volume}' face ${e.face}: ${e.detail}`;
    case 'RotationNotMultipleOf90': return `unit '${e.unit}': rotation_y ${e.value} not a multiple of 90°`;
    case 'RowCountOutOfRange': return `row '${e.id}': count ${e.count} out of [1,500]`;
    case 'ScatterTooManyInstances': return `scatter '${e.id}': projected ${e.projected} > 2000`;
    case 'TotalPartsExceeded': return `total parts ${e.count} > 4000`;
    case 'NonFiniteFloat': return `unit '${e.unit}': non-finite float in ${e.field}`;
    case 'EmptyGroup': return `group '${e.id}' has no parts`;
    case 'MirrorOfMirror': return `mirror '${e.id}' targets another mirror '${e.target}'`;
  }
}
