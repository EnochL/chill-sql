import { createMysqlClient } from './index'

type User = {
    user_id: string
    user_name: string
    user_phone?: string
    user_company?: string
    user_height?: number
}
type MyTables = {
    user: User
}

const mysqlClient = createMysqlClient<MyTables>({
    host: `localhost`,
    user: `root`,
    port: 3306,
    password: `whosyourdaddy`,
    database: `test`,
    charset: 'utf8mb4_unicode_ci',
    timeout: 8000,
})

// query
mysqlClient.tables.user.select('*')
    .where(e => e.user_company.eq(`doge`))
    .and(e => e.user_height.gte(166))
    .exec() // return User[]

mysqlClient.tables.user.select(['user_name'])
    .where(e =>
        e.user_company.eq(`doge`)
            .or(e.user_company.eq('cate'))
    )
    .and(e => e.user_height.gte(166))
    .exec() // return Pick<User,'user_name'>[]
// insert
mysqlClient.tables.user.insert({
    user_id: 'Enoch',
    user_name: 'EnochL',
    user_company: 'doge'
})

// update
mysqlClient.tables.user
    .update({
        user_company: 'capsule'
    })
    .where(e => e.user_id.eq('Enoch'))
    .exec()

// delete
mysqlClient.tables.user
    .delete()
    .where(e => e.user_id.eq('xxx'))
    .exec()

// transaction
mysqlClient.runTransaction(async client => {
    await client.tables.user.insert({
        user_id: 'Enoch',
        user_name: 'EnochL',
        user_company: 'doge',
        user_height: 180
    })
    await client.tables.user.insert({
        user_id: 'somebody',
        user_name: 'whoknows',
        user_company: 'doge',
        user_height: 166
    })
})



