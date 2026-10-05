import ts from '@typescript/typescript6'

// All service requests use this backend, independent of the consumer's compiler.
export default ts

export const documentRegistry = ts.createDocumentRegistry()

let virtualVersion = 0
/** A version is never reused for another virtual file's contents. */
export function createVersion(): string {
  return `virtual:${++virtualVersion}`
}
