import mysql, { EscapeFunctions, MysqlError, Pool, PoolConfig, PoolConnection, QueryFunction } from 'mysql'
import { ArrayElementOf, AsString, MaybeArray, Table, Tables } from './types'
import { Int } from '../types'
import { withoutUndefined } from '../utils'
import {
    ConditionExpr,
    ConditionExprBuilderProvider,
    invokeConditionExprBuilderProvider,
    parseMysqlExpr,
    putNewParam
} from './expr'
import '../array-extension'

// type NonObjKeysOf<T extends object> = {
//     [K in keyof T]: T[K] extends object ? never : K
// }[keyof T]

interface QueryHelper extends EscapeFunctions {
    query: QueryFunction
}

async function getConnFromPool(pool: Pool): Promise<PoolConnection> {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                reject(err)
            } else {
                resolve(connection)
            }
        })
    })
}

async function beginTransaction(conn: PoolConnection): Promise<PoolConnection> {
    return new Promise((resolve, reject) => {
        conn.beginTransaction(err => {
            if (err) {
                reject(err)
            } else {
                resolve(conn)
            }
        })
    })
}

async function commitConn<T>(conn: PoolConnection, rs: T): Promise<T> {
    return new Promise((resolve, reject) => {
        conn.commit(err => {
            if (err) {
                reject(err)
            } else {
                resolve(rs)
            }
        })
    })
}

async function rollbackConnQuietly(conn: PoolConnection): Promise<PoolConnection> {
    // ignore error
    return new Promise<PoolConnection>((resolve) => {
        conn.rollback(() => {
            resolve(conn)
        })
    }).catch(() => conn)
}

function releaseConnQuietly(conn: PoolConnection) {
    try {
        conn.release()
    } catch (e) {
        console.log(`release mysql connection error`, e)
    }
}

export type MysqlClientWithTransaction<TABLES_DEF extends Tables> = Omit<MysqlClient<TABLES_DEF>, 'runTransaction'>

export type MysqlModifyResult = {
    'fieldCount': number,
    'affectedRows': number,
    'insertId': number,
    'serverStatus': number,
    'warningCount': number,
    'message': string,
    'protocol41': boolean,
    'changedRows': number
}

class MysqlClient<TABLES_DEF extends Tables> {
    constructor(private pool: Pool | PoolConnection) {
    }

    tables = new Proxy(this.pool, {
        get(target: Pool, p: PropertyKey): any {
            return new CommandBooter(p.toString(), target)
        }
    }) as any as { [K in keyof TABLES_DEF]: CommandBooter<TABLES_DEF[K]> }

    async runTransaction<T>(action: (client: MysqlClientWithTransaction<TABLES_DEF>) => Promise<T>): Promise<T> {
        if (!('getConnection' in this.pool)) {
            return Promise.reject(`this client can't begin a transaction`)
        }
        const conn = await getConnFromPool(this.pool)
        return beginTransaction(conn)
            .then(c => action(new MysqlClient(c)))
            .then(rs => commitConn(conn, rs))
            .catch(async err => {
                await rollbackConnQuietly(conn)
                throw err
            })
            .finally(() => releaseConnQuietly(conn))
    }

    from<TABLE_NAME extends keyof TABLES_DEF>(table: TABLE_NAME): QueryCommand<TABLES_DEF[TABLE_NAME], TABLES_DEF[TABLE_NAME]> {
        return new QueryCommand<TABLES_DEF[TABLE_NAME], TABLES_DEF[TABLE_NAME]>(table as string, this.pool)
    }

    update<TABLE_NAME extends keyof TABLES_DEF>(dataName: TABLE_NAME): UpdateCommand<TABLES_DEF[TABLE_NAME]> {
        return new UpdateCommand<TABLES_DEF[TABLE_NAME]>(dataName as string, this.pool)
    }

    insert<TABLE_NAME extends keyof TABLES_DEF>(dataName: TABLE_NAME): InsertCommand<TABLES_DEF[TABLE_NAME]> {
        return new InsertCommand<TABLES_DEF[TABLE_NAME]>(dataName as string, this.pool)
    }

    delete<TABLE_NAME extends keyof TABLES_DEF>(dataName: TABLE_NAME): DeleteCommand<TABLES_DEF[TABLE_NAME]> {
        return new DeleteCommand<TABLES_DEF[TABLE_NAME]>(dataName as string, this.pool)
    }

    exec(sql: string, params?: Record<string, any>): Promise<any> {
        return execSql(this.pool, sql, params)
    }
}

abstract class SqlCommand<TABLE extends Table, CMD_RESULT> {
    constructor(protected table: string) {
    }

    abstract exec(): Promise<CMD_RESULT>
}

abstract class SqlConditionalCommand<TABLE extends Table, CMD_RESULT> extends SqlCommand<TABLE, CMD_RESULT> {

    protected conditionExpr?: ConditionExpr = undefined

    where(exprBuilderProvider: ConditionExprBuilderProvider<TABLE> | undefined): this {
        if (!exprBuilderProvider) {
            this.conditionExpr = undefined
            return this
        }
        this.conditionExpr = invokeConditionExprBuilderProvider(exprBuilderProvider)
        return this
    }

    and(exprBuilderProvider: ConditionExprBuilderProvider<TABLE>): this {
        const newExpr = invokeConditionExprBuilderProvider(exprBuilderProvider)
        if (!newExpr) {
            return this
        }
        if (this.conditionExpr) {
            this.conditionExpr = {
                type: 'and',
                exprs: [this.conditionExpr, newExpr]
            }
        } else {
            this.conditionExpr = newExpr
        }
        return this
    }

    or(exprBuilderProvider: ConditionExprBuilderProvider<TABLE>): this {
        const newExpr = invokeConditionExprBuilderProvider(exprBuilderProvider)
        if (!newExpr) {
            return this
        }
        if (this.conditionExpr) {
            this.conditionExpr = {
                type: 'or',
                exprs: [this.conditionExpr, newExpr]
            }
        } else {
            this.conditionExpr = newExpr
        }
        return this
    }

    not(exprBuilderProvider: ConditionExprBuilderProvider<TABLE>): this {
        const newExpr = invokeConditionExprBuilderProvider(exprBuilderProvider)
        if (!newExpr) {
            return this
        }
        const newExprNot: ConditionExpr = { type: 'not', expr: newExpr }
        if (this.conditionExpr) {
            this.conditionExpr = {
                type: 'and',
                exprs: [this.conditionExpr, newExprNot]
            }
        } else {
            this.conditionExpr = newExprNot
        }
        return this
    }
}

type OrderBy<TABLE extends Table> = `${AsString<keyof TABLE>}${'' | ' asc' | ' desc'}`

export class QueryCommand<TABLE extends Table, RESULT_TYPE extends Record<string, unknown> | Int = TABLE> extends SqlConditionalCommand<TABLE, RESULT_TYPE extends Int ? Int : RESULT_TYPE[]> {

    private _select?: Array<keyof TABLE> | '*' | `count(*)` = undefined

    private _limit?: number | [number, number]

    private _orderBy?: MaybeArray<OrderBy<TABLE>>

    constructor(table: string, private pool: QueryHelper) {
        super(table)
    }

    select<Fields extends Array<keyof TABLE> | '*' | `count(*)`>(fields: Fields): QueryCommand<TABLE, Pick<TABLE, ArrayElementOf<Fields>>> {
        this._select = fields
        return this as any as QueryCommand<TABLE, Pick<TABLE, ArrayElementOf<Fields>>>
    }

    count(): QueryCommand<TABLE, Int> {
        this._select = 'count(*)'
        return this as QueryCommand<TABLE, Int>
    }

    limit(l1: number, l2?: number): this {
        if (l2 != null) {
            this._limit = [l1, l2]
        } else {
            this._limit = l1
        }
        return this
    }

    orderBy(ob: MaybeArray<OrderBy<TABLE>>): this {
        this._orderBy = ob
        return this
    }

    private escapeOrderBy(ob: OrderBy<TABLE>): string {
        const [field, order] = ob.split(' ')
        return `${this.pool.escapeId(field)}${order ? ` ${order}` : ''}`
    }

    exec(): Promise<RESULT_TYPE extends Int ? Int : RESULT_TYPE[]> {
        let sql = `select`
        const selectedFields = this._select
        const fieldsSql = typeof selectedFields !== 'string' && selectedFields && selectedFields.isNotEmpty()
            ? selectedFields.map(it => this.pool.escapeId(it.toString())).join(',')
            : selectedFields
        sql += ` ${fieldsSql} from ${this.pool.escapeId(this.table)} `

        let params: Record<string, any> | undefined = undefined
        if (this.conditionExpr) {
            params = {}
            const whereExprSql = this.conditionExpr && parseMysqlExpr(this.conditionExpr, params)
            sql += ` where ${whereExprSql} `
        }

        if (Array.isArray(this._orderBy) && this._orderBy.isNotEmpty()) {
            sql += ` order by ${this._orderBy.map(it => this.escapeOrderBy(it)).join(',')} `
        } else if (this._orderBy && typeof this._orderBy === 'string') {
            sql += ` order by ${this.escapeOrderBy(this._orderBy)} `
        }

        if (typeof this._limit === 'number') {
            sql += ` limit ${this._limit} `
        } else if (Array.isArray(this._limit) && this._limit.length === 2) {
            sql += ` limit ${this._limit.join(',')} `
        }
        return execSql(this.pool, sql, params)
            .then(rs => {
                if (selectedFields == 'count(*)') {
                    return rs[0]['count(*)']
                }
                return rs
            })
    }
}

export class UpdateCommand<TABLE extends Table> extends SqlConditionalCommand<TABLE, MysqlModifyResult> {
    private updateData?: Partial<TABLE> = undefined

    constructor(table: string, private pool: QueryHelper) {
        super(table)
    }

    set(updateData: Partial<TABLE>): this {
        this.updateData = updateData
        return this
    }

    exec(): Promise<MysqlModifyResult> {
        const data = this.updateData
        if (!data) {
            throw Error('nothing to update')
        }
        if (!this.conditionExpr) {
            throw Error(`can't update without condition`)
        }
        const params = {}
        const paramNameUpdate = putNewParam(params, 'record', data)
        const whereSql = parseMysqlExpr(this.conditionExpr, params)

        let sql = `update ${this.pool.escapeId(this.table)} `
        sql += ` set ${paramNameUpdate} `
        sql += ` where ${whereSql}`
        return execSql(this.pool, sql, params)
    }

    /*exec(): Promise<MysqlModifyResult> {
        const data = this.updateData
        if (!data) {
            throw Error('nothing to update')
        }
        if (!this.conditionExpr) {
            throw Error(`can't update without condition`)
        }
        const params = {}
        const field2ParamName = Object.entries(data).map(it => {
            const fieldName = it[0]
            const value = it[1]
            const paramName = putNewParam(params, fieldName, value)
            return [fieldName, paramName]
        })
        const whereSql = parseMysqlExpr(this.conditionExpr, params)

        let sql = `update ${this.pool.escapeId(this.table)} `
        const setSql = field2ParamName.map(it => `${this.pool.escapeId(it[0])}=${it[1]}`).join(',')
        sql += ` set ${setSql} `
        sql += ` where ${whereSql}`
        return execSql(this.pool, sql, params)
    }*/
}

export class DeleteCommand<TABLE extends Table> extends SqlConditionalCommand<TABLE, MysqlModifyResult> {

    constructor(table: string, private pool: QueryHelper) {
        super(table)
    }

    exec(): Promise<MysqlModifyResult> {
        if (!this.conditionExpr) {
            throw Error(`can't delete without condition`)
        }
        const params = {}
        const whereSql = parseMysqlExpr(this.conditionExpr, params)
        const sql = `delete
                     from ${this.pool.escapeId(this.table)}
                     where ${whereSql}`
        return execSql(this.pool, sql, params)
    }
}

export class InsertCommand<TABLE extends Table> extends SqlCommand<TABLE, MysqlModifyResult> {
    private newData?: TABLE = undefined
    private data4Updating?: Partial<TABLE> = undefined

    constructor(table: string, private pool: QueryHelper) {
        super(table)
    }

    values(data: TABLE): this {
        this.newData = data
        return this
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    orUpdate(data: Partial<TABLE>): this {
        this.data4Updating = data
        return this
    }

    exec(): Promise<MysqlModifyResult> {
        const data = this.newData
        const data4Updating = this.data4Updating
        if (!data) {
            throw Error(`no data to insert`)
        }
        const params = {}
        const paramNameInsert = putNewParam(params, `record`, data)
        let sql = `insert into ${this.pool.escapeId(this.table)}
                   set ${paramNameInsert} `
        if (data4Updating) {
            const paramNameUpdate = putNewParam(params, `record`, data4Updating)
            sql += ` on duplicate key update ${paramNameUpdate} `
        }
        return execSql(this.pool, sql, params)
    }

    /*exec(): Promise<MysqlModifyResult> {
        const data = this.newData
        if (!data) {
            throw Error(`no data to insert`)
        }
        const params = {}
        const field2ParamName = Object.entries(data).map(it => {
            const fieldName = it[0]
            const value = it[1]
            const paramName = putNewParam(params, fieldName, value)
            return [fieldName, paramName]
        })

        let sql = `insert into ${this.pool.escapeId(this.table)}(${field2ParamName.map(it => this.pool.escapeId(it[0])).join(',')}) `
        sql += ` values (${field2ParamName.map(it => it[1]).join(',')})`
        return execSql(this.pool, sql, params)
    }*/
}

function execSql(queryHelper: { query: QueryFunction }, sql: string, params?: Record<string, any>): Promise<any> {
    // console.log(sql)
    // console.log(params)
    // return null as any as Promise<any>
    return new Promise((resolve, reject) => {
        // console.log(`exec sql = ${sql}`)
        // console.log(`params = ${JSON.stringify(params)}`)
        queryHelper.query(sql, params, (err: MysqlError | null, results?: any) => {
            if (err) {
                console.error(`sql error\n${JSON.stringify(err, null, 4)}`)
                reject(err)
            } else {
                resolve(results)
            }
        })
    })
}

export class CommandBooter<TABLE extends Table> {
    private expr?: ConditionExpr = undefined

    constructor(private table: string, private pool: Pool) {
    }

    count(): QueryCommand<TABLE, Int> {
        return this.select('count(*)')
    }

    select<Fields extends Array<keyof TABLE> | '*' | 'count(*)'>(fields: Fields)
        : QueryCommand<TABLE,
        Fields extends '*'
            ? TABLE
            : Fields extends 'count(*)'
                ? Int
                : Pick<TABLE, ArrayElementOf<Fields>>> {
        const cmd = new QueryCommand<TABLE>(this.table, this.pool)
        const expr = this.expr
        if (expr) {
            cmd.where(expr)
        }
        // if (Array.isArray(fields)) {
        cmd.select(fields)
        // }
        return cmd as QueryCommand<TABLE,
            Fields extends '*'
                ? TABLE
                : Fields extends 'count(*)'
                    ? Int
                    : Pick<TABLE, ArrayElementOf<Fields>>>
    }

    update(updateData: Partial<TABLE>): UpdateCommand<TABLE> {
        const dataWithoutUndef = withoutUndefined(updateData)
        const cmd = new UpdateCommand<TABLE>(this.table, this.pool)
        cmd.set(dataWithoutUndef)
        return cmd
    }

    delete(): DeleteCommand<TABLE> {
        const cmd = new DeleteCommand<TABLE>(this.table, this.pool)
        const expr = this.expr
        if (expr) {
            cmd.where(expr)
        }
        return cmd
    }

    insert(data: TABLE): InsertCommand<TABLE> {
        const dataWithoutUndef = withoutUndefined(data)
        return new InsertCommand<TABLE>(this.table, this.pool).values(dataWithoutUndef)
    }
}

export function createMysqlClient<TABLES_DEF extends Tables>(config: PoolConfig | string): MysqlClient<TABLES_DEF> {
    const pool = mysql.createPool(config)
    pool.config.connectionConfig.queryFormat = function (query, values) {
        if (!values) return query
        return query.replace(/\:(\w+)/g, function (txt: any, key: string) {
            if (values.hasOwnProperty(key)) {
                return pool.escape(values[key])
            }
            return txt
        }.bind(this))
    }
    return new MysqlClient<TABLES_DEF>(pool)
}

