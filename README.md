# Introduction
Chill-SQL is a TypeScript-based MySQL library designed to offer a type-safe and efficient way to build and execute SQL queries. Leveraging the robust type system of TypeScript and seamlessly integrating with Jetbrains IDEs, it provides developers with convenient type hints and checks, significantly enhancing development speed and code quality.

# Features
* **Type-Safe SQL Building**: Utilize the power of TypeScript's type system to reduce runtime errors.
* **IDE Friendly**: Seamless integration with Jetbrains IDEs for real-time type hints and code completion.
* **Simplified Query Building**: An easy-to-use API to quickly construct complex SQL queries.
* **Flexible Query Operations**: Supports a variety of operations including joins, sorting, aggregation, etc.
* **Transaction Support**: Convenient transaction handling methods to ensure data consistency.

# Installation
```shell
npm install chill-sql
# or
yarn add chill-sql
```



# Quick Start
Here's a simple example to demonstrate how to use chill-sql for MySQL operations:
```typescript
import { createMysqlClient } from 'chill-sql'

// Define table types
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

// Create MySQL client instance
const mysqlClient = createMysqlClient<MyTables>({
    host: `127.0.0.1`,
    user: `root`,
    port: 3306,
    password: `whosyourdaddy`,
    database: `test`,
    charset: 'utf8mb4_unicode_ci',
    timeout: 8000,
})

// Usage examples
// Query operation

// the type of users is User[]
const users = await mysqlClient.tables.user.select('*')
    .where(e => e.user_company.eq(`doge`))
    .and(e => e.user_height.gte(166))
    .exec()


// the type of result is Pick<User,'user_name'>[]
const result = await mysqlClient.tables.user.select('user_name')
    .where(e =>
        e.user_company.eq(`doge`)
            .or(e.user_company.eq('cate'))
    )
    .and(e => e.user_height.gte(166))
    .exec()


// the type of joinResult is Array<UserGroup & {ownerName: string}>
const joinResult = await mysqlClient.tables.user_group.as('g')
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
    .exec()

// the type of countResult is Array<{ownerName: string, groupCount: number}>
const countResult = await mysqlClient.tables.user_group.as('g')
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
    .exec()

// Insert operation
await mysqlClient.tables.user.insert({
    user_id: 'Enoch',
    user_name: 'EnochL',
    user_company: 'doge'
})

// Update operation
await mysqlClient.tables.user
    .update({
        user_company: 'capsule'
    })
    .where(e => e.user_id.eq('Enoch'))
    .exec()

// Delete operation
await mysqlClient.tables.user
    .delete()
    .where(e => e.user_id.eq('xxx'))
    .exec()

// Transaction operation
await mysqlClient.runTransaction(async client => {
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
# License
Chill-SQL is open-sourced software licensed under the MIT license.

# Issues and Support
If you encounter any issues or have questions regarding chill-sql, please feel free to open an [issue here](https://github.com/EnochL/chill-sql/issues). Your feedback and questions are valuable to me, and I'll do my best to assist you.

# Show Your Support
If you find chill-sql helpful or interesting, please consider giving it a star on GitHub! Your support means a lot and motivates me to continue improving this project. To star the project, just click on the ⭐️ button in the top right corner of the [chill-sql repository page](https://github.com/EnochL/chill-sql).

Thank you for using and supporting chill-sql!

[//]: # (# Acknowledgments)

[//]: # (Special thanks to all the developers and contributors who have contributed to this project!)

