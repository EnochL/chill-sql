import './array-extension'
import mysql, { Pool, PoolConfig, PoolConnection } from 'mysql'
import { Tables } from './types'
import { CommandBooter, DeleteCommand, execSql, InsertCommand, QueryCommand, UpdateCommand } from './command'

export type MysqlClientWithTransaction<TABLES_DEF extends Tables> = Omit<MysqlClient<TABLES_DEF>, 'runTransaction'>

export class MysqlClient<TABLES_DEF extends Tables> {
    public tables: { [K in keyof TABLES_DEF]: CommandBooter<TABLES_DEF[K], K & string, TABLES_DEF> }

    constructor(private pool: Pool | PoolConnection) {
        this.tables = new Proxy(this.pool, {
            get(target: Pool, p: PropertyKey): any {
                return new CommandBooter(p.toString(), target)
            }
        }) as any as { [K in keyof TABLES_DEF]: CommandBooter<TABLES_DEF[K], K & string, TABLES_DEF> }
    }

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

    from<TABLE_NAME extends keyof TABLES_DEF & string>(table: TABLE_NAME): QueryCommand<TABLES_DEF[TABLE_NAME]> {
        return new QueryCommand(table, this.pool)
    }

    update<TABLE_NAME extends keyof TABLES_DEF & string>(dataName: TABLE_NAME): UpdateCommand<TABLES_DEF[TABLE_NAME]> {
        return new UpdateCommand<TABLES_DEF[TABLE_NAME]>(dataName as string, this.pool)
    }

    insert<TABLE_NAME extends keyof TABLES_DEF & string>(dataName: TABLE_NAME): InsertCommand<TABLES_DEF[TABLE_NAME]> {
        return new InsertCommand<TABLES_DEF[TABLE_NAME]>(dataName as string, this.pool)
    }

    delete<TABLE_NAME extends keyof TABLES_DEF & string>(dataName: TABLE_NAME): DeleteCommand<TABLES_DEF[TABLE_NAME]> {
        return new DeleteCommand<TABLES_DEF[TABLE_NAME]>(dataName as string, this.pool)
    }

    exec(sql: string, params?: Record<string, any>): Promise<any> {
        return execSql(this.pool, sql, params)
    }
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
    try {
        return new Promise((resolve, reject) => {
            conn.beginTransaction(err => {
                if (err) {
                    reject(err)
                } else {
                    resolve(conn)
                }
            })
        })
    } catch (e) {
        return Promise.reject(e)
    }
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
    try {
        return await new Promise((resolve) => {
            conn.rollback(() => {
                resolve(conn)
            })
        })
    } catch (e) {
        return Promise.resolve(conn)
    }
}

function releaseConnQuietly(conn: PoolConnection) {
    try {
        conn.release()
    } catch (e) {
        console.log(`release mysql connection error`, e)
    }
}

export function createMysqlClient<TABLES_DEF extends Tables>(config: PoolConfig | string): MysqlClient<TABLES_DEF> {
    const pool = mysql.createPool(config)
    pool.config.connectionConfig.queryFormat = function (query, values) {
        console.log(`query:`+query)
        if (!values) return query
        const finalSql = query.replace(
            /\:(\w+)/g,
            (txt: any, key: string) => {
                if (values.hasOwnProperty(key)) {
                    return pool.escape(values[key])
                }
                return txt
            }
        )
        console.log(finalSql)
        return finalSql
    }
    return new MysqlClient<TABLES_DEF>(pool)
}

