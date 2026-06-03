export interface Fruit {
  /** The display name of the fruit */
  name: string
  price: number
  availableQuantity: number
}

export function registerFruit(_fruit: Fruit): void {}
