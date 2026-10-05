/** A fixture, configuration, or language-service failure with its original cause. */
export class SelenitaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`selenita: ${message}`, options)
    this.name = 'SelenitaError'
  }
}
