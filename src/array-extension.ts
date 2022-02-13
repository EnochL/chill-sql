import { Int } from './types'

export type NonNullAndUndefinedOf<T> = Exclude<T, undefined | null>

declare global {
    interface Array<T> {
        isEmpty(): boolean;

        isNotEmpty(): boolean;

        flatten<U>(this: (U | U[])[]): U[];

        flatMap<U>(mapper: (ele: T, index: Int) => U[]): U[];

        flatMapNotNull<U>(mapper: (ele: T, index: Int) => U[] | null | undefined): U[];

        joinWith(separator: T): T[];

        take(limit: Int): T[];

        any(predicate: (e: T) => boolean): boolean;

        all(predicate: (e: T) => boolean): boolean;

        last(): T;

        first(): T;

        firstOrUndefined(): T | undefined;

        lastOrUndefined(): T | undefined;

        filterNotNull(): NonNullAndUndefinedOf<T>[];

        mapNotNull<U>(mapper: (ele: T, index: Int) => U): Exclude<U, null | undefined>[];

        contains(element: T): boolean;

        distinct(): T[]

        distinctBy<U>(selector: (e: T) => U): T[]

        groupBy<K>(selector: (e: T) => K): [K, T[]][]

        splitBySize(size: Int): T[][]

        findLastIndex(predicate: (value: T, index: number, arr: T[]) => unknown): number;

        remove(ele: T): boolean

        removeOneIf(predicate: (ele: T) => boolean): T | undefined

        pickBy(selector: (a: T, b: T, aIndex: number, bIndex: number, arr: T[]) => T): T | undefined

        count(predicate: (value: T, index: number, arr: T[]) => unknown): number;

        sumBy(predicate: (value: T, index: number, arr: T[]) => number): number;

        fold<R>(initial: R, operation: (acc: R, value: T, index: number, arr: T[]) => R): R;

        sum<T extends number>(): number;

        avg<T extends number>(): number;

        maxByOrUndefined(selector: (ele: T, index: number, arr: T[]) => number): T | undefined;

        minByOrUndefined(selector: (ele: T, index: number, arr: T[]) => number): T | undefined;

        maxOrUndefined<T extends number>(): number | undefined;

        minOrUndefined<T extends number>(): number | undefined;

        sorted<T extends number>(): number[];

        sortedDescending<T extends number>(): number[];

        sortedBy(selector: (ele: T) => number): T[];

        sortedByDescending(selector: (ele: T) => number): T[];
    }
}

export type UnpackArray<T> = T extends (infer U)[] ? U : T;

((proto) => {
        if (typeof proto.isEmpty !== 'function') {
            proto.isEmpty = function isEmpty<T>(this: T[]): boolean {
                return this.length === 0
            }
        }
        if (typeof proto.isNotEmpty !== 'function') {
            proto.isNotEmpty = function isNotEmpty<T>(this: T[]): boolean {
                return this.length !== 0
            }
        }
        if (typeof proto.flatten !== 'function') {
            proto.flatten = function flatten<U>(this: (U[] | U)[]): U[] {
                let ret: any[] = []
                for (let item of this) {
                    if (Array.isArray(item)) {
                        ret.push(...item)
                    } else if (ret) {
                        ret.push(item)
                    }
                }
                return ret
            }
        }
        if (typeof proto.flatMap !== 'function') {
            proto.flatMap = function flatMap<T, U>(this: T[], mapper: (ele: T, index: Int) => U[]): U[] {
                return this.map(mapper).flatten()
            } as any
        }
        if (typeof proto.flatMapNotNull !== 'function') {
            proto.flatMapNotNull = function flatMapNotNull<T, U>(this: T[], mapper: (ele: T, index: Int) => U[]): U[] {
                return this.mapNotNull(mapper).flatten()
            } as any
        }
        if (typeof proto.joinWith !== 'function') {
            proto.joinWith = function joinWith<T>(this: T[], separator: T): T[] {
                const ret: T[] = []
                for (let i = 0; i < this.length; i++) {
                    if (i !== 0) {
                        ret.push(separator)
                    }
                    ret.push(this[i])
                }
                return ret
            }
        }
        if (typeof proto.take !== 'function') {
            proto.take = function take<T>(this: T[], limit: Int): T[] {
                const ret: T[] = []
                for (let i = 0; i < this.length && i < limit; i++) {
                    ret.push(this[i])
                }
                return ret
            }
        }
        if (typeof proto.any !== 'function') {
            proto.any = function any<T>(this: T[], predicate: (e: T) => boolean): boolean {
                for (const ele of this) {
                    if (predicate(ele)) return true
                }
                return false
            }
        }
        if (typeof proto.all !== 'function') {
            proto.all = function all<T>(this: T[], predicate: (e: T) => boolean): boolean {
                for (const ele of this) {
                    if (!predicate(ele)) return false
                }
                return true
            }
        }
        if (typeof proto.last !== 'function') {
            proto.last = function last<T>(this: T[]): T {
                if (this.isEmpty()) throw  new Error('Array is empty.')
                return this[this.length - 1]
            }
        }
        if (typeof proto.first !== 'function') {
            proto.first = function first<T>(this: T[]): T {
                if (this.isEmpty()) throw  new Error('Array is empty.')
                return this[0]
            }
        }
        if (typeof proto.firstOrUndefined !== 'function') {
            proto.firstOrUndefined = function firstOrUndefined<T>(this: T[]): T | undefined {
                if (this.isEmpty()) return undefined
                return this[0]
            }
        }
        if (typeof proto.lastOrUndefined !== 'function') {
            proto.lastOrUndefined = function lastOrUndefined<T>(this: T[]): T | undefined {
                if (this.isEmpty()) return undefined
                return this[this.length - 1]
            }
        }
        if (typeof proto.filterNotNull !== 'function') {
            proto.filterNotNull = function filterNotNull<T>(this: T[]): NonNullAndUndefinedOf<T>[] {
                const ret: any[] = []
                for (const e of this) {
                    if (e !== undefined && e !== null) {
                        ret.push(e)
                    }
                }
                return ret
            }
        }
        if (typeof proto.mapNotNull !== 'function') {
            proto.mapNotNull = function mapNotNull<T, U>(this: T[], mapper: (ele: T, index: Int) => U): Exclude<U, null | undefined>[] {
                const ret: any[] = []
                for (let i = 0; i < this.length; i++) {
                    const m = mapper(this[i], i)
                    if (m != null) { // 防止空字符串被忽略
                        ret.push(m)
                    }
                }
                return ret
            }
        }
        if (typeof proto.contains !== 'function') {
            proto.contains = function contains<T>(this: T[], element: T): boolean {
                return this.indexOf(element) >= 0
            }
        }
        if (typeof proto.distinct !== 'function') {
            proto.distinct = function distinct<T>(this: T[]): T[] {
                const ret: T[] = []
                for (const e of this) {
                    if (!ret.contains(e)) {
                        ret.push(e)
                    }
                }
                return ret
            }
        }
        if (typeof proto.distinctBy !== 'function') {
            proto.distinctBy = function distinctBy<T, U>(this: T[], selector: (e: T) => U): T[] {
                const ret: T[] = []
                for (const e of this) {
                    if (!ret.any(r => selector(r) == selector(e))) {
                        ret.push(e)
                    }
                }
                return ret
            }
        }
        if (typeof proto.groupBy !== 'function') {
            proto.groupBy = function groupBy<T, K>(this: T[], selector: (e: T) => K): [K, T[]][] {
                const ret: [K, T[]][] = []
                for (const e of this) {
                    const key = selector(e)
                    let key2Values = ret.find(r => r.first() == key)
                    if (key2Values != null) {
                        key2Values[1].push(e)
                    } else {
                        key2Values = [key, [e]]
                        ret.push(key2Values)
                    }
                }
                return ret
            }
        }
        if (typeof proto.splitBySize !== 'function') {
            proto.splitBySize = function groupBy<T>(this: T[], size: Int): T[][] {
                const arrList: T[][] = []
                for (let i = 0; i < this.length; i += size) {
                    arrList.push(this.slice(i, i + size))
                }
                return arrList
            }
        }
        if (typeof proto.findLastIndex !== 'function') {
            proto.findLastIndex = function findLastIndex<T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown): number {
                for (let i = this.length - 1; i > -1; i--) {
                    if (predicate(this[i], i, this)) {
                        return i
                    }
                }
                return -1
            }
        }
        if (typeof proto.remove !== 'function') {
            proto.remove = function remove<T>(this: T[], ele: T): boolean {
                for (let i = this.length - 1; i > -1; i--) {
                    if (this[i] === ele) {
                        this.splice(i, 1)
                        return true
                    }
                }
                return false
            }
        }
        if (typeof proto.removeOneIf !== 'function') {
            proto.removeOneIf = function removeOneIf<T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown): T | undefined {
                for (let i = this.length - 1; i > -1; i--) {
                    const curEle = this[i]
                    if (predicate(curEle, i, this)) {
                        this.splice(i, 1)
                        return curEle
                    }
                }
                return undefined
            }
        }
        if (typeof proto.pickBy !== 'function') {
            proto.pickBy = function pickBy<T>(this: T[], selector: (a: T, b: T, aIndex: number, bIndex: number, obj: T[]) => T): T | undefined {
                if (this.length < 2) {
                    return this[0]
                }
                let ret = this[0]
                let aIndex = 0
                for (let i = 1; i < this.length; i++) {
                    const curEle = this[i]
                    const curPicked = selector(ret, curEle, aIndex, i, this)
                    if (curPicked !== ret) {
                        ret = curPicked
                        aIndex = i
                    }
                }
                return ret
            }
        }
        if (typeof proto.count !== 'function') {
            proto.count = function count<T>(this: T[], predicate: (value: T, index: number, obj: T[]) => unknown): number {
                let cnt = 0
                for (let i = 0; i < this.length; i++) {
                    if (predicate(this[i], i, this)) {
                        cnt++
                    }
                }
                return cnt
            }
        }
        if (typeof proto.sum !== 'function') {
            proto.sum = function sum(this: number[]): number {
                let sum = 0
                for (let i = 0; i < this.length; i++) {
                    sum += this[i]
                }
                return sum
            }
        }
        if (typeof proto.avg !== 'function') {
            proto.avg = function avg(this: number[]): number {
                let sum = 0
                for (let i = 0; i < this.length; i++) {
                    sum += this[i]
                }
                return sum / this.length
            }
        }
        if (typeof proto.sumBy !== 'function') {
            proto.sumBy = function sumBy<T>(this: T[], predicate: (value: T, index: number, obj: T[]) => number): number {
                let sum = 0
                for (let i = 0; i < this.length; i++) {
                    sum += predicate(this[i], i, this)
                }
                return sum
            }
        }
        if (typeof proto.fold !== 'function') {
            proto.fold = function fold<T, R>(this: T[], initial: R, operation: (acc: R, value: T, index: number, obj: T[]) => R): R {
                let accumulator = initial
                for (let i = 0; i < this.length; i++) {
                    accumulator = operation(accumulator, this[i], i, this)
                }
                return accumulator
            }
        }
        if (typeof proto.maxByOrUndefined !== 'function') {
            proto.maxByOrUndefined = function maxByOrUndefined<T>(this: T[], selector: (ele: T, index: number, arr: T[]) => number): T | undefined {
                if (this.length === 0) {
                    return undefined
                }
                let max = selector(this[0], 0, this)
                let maxIndex = 0
                for (let i = 1; i < this.length; i++) {
                    const curValue = selector(this[i], i, this)
                    if (curValue > max) {
                        max = curValue
                        maxIndex = i
                    }
                }
                return this[maxIndex]
            }
        }
        if (typeof proto.minByOrUndefined !== 'function') {
            proto.minByOrUndefined = function minByOrUndefined<T>(this: T[], selector: (ele: T, index: number, arr: T[]) => number): T | undefined {
                if (this.length === 0) {
                    return undefined
                }
                let min = selector(this[0], 0, this)
                let minIndex = 0
                for (let i = 1; i < this.length; i++) {
                    const curValue = selector(this[i], i, this)
                    if (curValue < min) {
                        min = curValue
                        minIndex = i
                    }
                }
                return this[minIndex]
            }
        }
        if (typeof proto.maxOrUndefined !== 'function') {
            proto.maxOrUndefined = function maxOrUndefined(this: number[]): number | undefined {
                if (this.length === 0) {
                    return undefined
                }
                let max = this[0]
                for (let i = 1; i < this.length; i++) {
                    const curValue = this[i]
                    if (curValue > max) {
                        max = curValue
                    }
                }
                return max
            }
        }
        if (typeof proto.minOrUndefined !== 'function') {
            proto.minOrUndefined = function minOrUndefined(this: number[]): number | undefined {
                if (this.length === 0) {
                    return undefined
                }
                let min = this[0]
                for (let i = 1; i < this.length; i++) {
                    const curValue = this[i]
                    if (curValue < min) {
                        min = curValue
                    }
                }
                return min
            }
        }
        if (typeof proto.sorted !== 'function') {
            proto.sorted = function sorted(this: number[]): number[] {
                if (this.length === 0) {
                    return []
                }
                const copy = [...this]
                copy.sort((a, b) => a - b)
                return copy
            }
        }
        if (typeof proto.sortedDescending !== 'function') {
            proto.sortedDescending = function sortedDescending(this: number[]): number[] {
                if (this.length === 0) {
                    return []
                }
                const copy = [...this]
                copy.sort((a, b) => b - a)
                return copy
            }
        }
        if (typeof proto.sortedBy !== 'function') {
            proto.sortedBy = function sortedBy<T>(this: T[], selector: (ele: T) => number): T[] {
                if (this.length === 0) {
                    return []
                }
                const copy = [...this]
                copy.sort((a, b) => selector(a) - selector(b))
                return copy
            }
        }
        if (typeof proto.sortedByDescending !== 'function') {
            proto.sortedByDescending = function sortedByDescending<T>(this: T[], selector: (ele: T) => number): T[] {
                if (this.length === 0) {
                    return []
                }
                const copy = [...this]
                copy.sort((a, b) => selector(b) - selector(a))
                return copy
            }
        }
    }
)(Array.prototype)
