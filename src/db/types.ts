type FieldValue = string | number | boolean | null | undefined
export type Table = {
    [key: string]: any
}

export interface Tables {
    [tableName: string]: Table
}

export type AsString<T> = T & string
export type MaybeArray<T> = T | T[]
export type ArrayElementOf<ARR> = ARR extends (infer E)[] ? E : ARR
