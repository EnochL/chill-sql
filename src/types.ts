import { EscapeFunctions, QueryFunction } from 'mysql'

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

export interface QueryHelper extends EscapeFunctions {
    query: QueryFunction
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export type PlainValue = null | undefined | boolean | number | string | PlainValue[] | Record<string, PlainValue>
export type PlainValueWithoutArr = null | undefined | boolean | number | string | Record<string, PlainValue>


export type NullableDictOf<T extends DictOf<any>> = {
    [K in keyof T]: T[K] | null
}

export type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never


export type MysqlModifyResult = {
    fieldCount: number
    affectedRows: number
    insertId: number
    serverStatus: number
    warningCount: number
    message: string
    protocol41: boolean
    changedRows: number
}