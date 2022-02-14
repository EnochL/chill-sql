export type Byte = number
export type Int = number
export type Long = number
export type Short = number
export type Float = number
export type DictOf<V> = {
    [key: string]: V
}
export type Table = {
    [key: string]: any
}

export interface Tables {
    [tableName: string]: Table
}

export type AsString<T> = T & string
export type MaybeArray<T> = T | T[]
export type ArrayElementOf<ARR> = ARR extends (infer E)[] ? E : ARR