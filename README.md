# chill-sql
Simple sql builder for mysql in typescript.<br><br>
Type checking helps you build sql easier and more efficiently, especially in Jetbrain IDE.<br><br>
Common sql syntax are supported, include select, insert, update, delete, where, orderBy, limit, join, having, sum, avg, count, max, min etc.<br><br>
Hope you guys enjoy the gorgeous coding experience.

# Usage
```typescript
type User = {
    user_id: string
    user_name: string
    user_phone?: string
    user_company?: string
    user_height?: number
}

type UserGroup = {
    group_id: string
    group_name: string
    group_owner_id: string
    group_created_time: number
}

type MyTables = {
    user: User
    user_group: UserGroup
}

const mysqlClient = createMysqlClient<MyTables>({
    host: `127.0.0.1`,
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

mysqlClient.tables.user.select('user_name')
    .where(e =>
        e.user_company.eq(`doge`)
            .or(e.user_company.eq('cate'))
    )
    .and(e => e.user_height.gte(166))
    .exec() // return Pick<User,'user_name'>[]

mysqlClient.tables.user_group.as('g')
    .join('user as u')
    .on(it =>
        it.u.user_id.eq(
            it.g.group_owner_id
        )
    )
    .select(
        'g.*',
        'u.user_name as ownerName'
    )
    .orderBy('g.group_created_time asc')
    .exec()// return Array<UserGroup & {ownerName: string}>

mysqlClient.tables.user_group.as('g')
    .join('user')
    .on(it =>
        it.user.user_id.eq(
            it.g.group_owner_id
        )
    )
    .select(
        'user.user_name as ownerName',
        'count(g.group_id) as groupCount'
    )
    .orderBy('g.group_created_time asc')
    .having(it => it.groupCount.gte(3))
    .exec()// return Array<{ownerName: string, groupCount: number}>

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
```