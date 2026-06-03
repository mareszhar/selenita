export declare function registerFruit(fruit: Fruit): void

export interface Fruit {
  /** The display name of the fruit */
  name: string
  price: number
  availableQuantity: number
}
