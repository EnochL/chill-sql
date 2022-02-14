import mysql, { EscapeFunctions, Pool, PoolConfig, PoolConnection, QueryFunction } from 'mysql'
import { Tables } from './types'
import '../array-extension'
import { CommandBooter, DeleteCommand, execSql, InsertCommand, QueryCommand, UpdateCommand } from './command'

// type NonObjKeysOf<T extends object> = {
//     [K in keyof T]: T[K] extends object ? never : K
// }[keyof T]



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

