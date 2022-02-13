import { DictOf } from './types'

export function withoutUndefined<D extends DictOf<any>>(data: D): D {
    const dataWithoutUndef = {} as any
    for (const key in data) {
        const value = data[key]
        if (value !== undefined) {
            dataWithoutUndef[key] = value
        }
    }
    return dataWithoutUndef
}