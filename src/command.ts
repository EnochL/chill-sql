import {
    ArrayElementOf,
    DictOf,
    Int,
    MaybeArray,
    MysqlModifyResult,
    NullableDictOf,
    QueryHelper,
    Table,
    UnionToIntersection
} from './types'
import {
    ConditionExpr,
    ConditionExprBuilderProvider,
    escapeSqlFieldExpr,
    invokeConditionExprBuilderProvider,
    invokeMultiTableConditionExprBuilderProvider,
    MultiTableConditionExprBuilderProvider,
    parseMysqlExpr,
    putNewParam
} from './expr'
import { MysqlError, Pool, QueryFunction } from 'mysql'
import { withoutUndefined } from './utils'

type AggFun = 'avg' | 'sum' | 'count' | 'max' | 'min'

//<editor-fold desc="single table types">
type TableFields<TABLE> = keyof TABLE
type TableSelections<TABLE> =
    Array<
        TableFields<TABLE>
        | `${TableFields<TABLE> & string} as ${string}`
        | `${AggFun}(${TableFields<TABLE> & string | `distinct ${keyof TABLE & string}`}) as ${string}`
    >
    | ['*']
    | [`count(*)`]

type OrderBy<TABLE extends Table, FIELD extends TableSelections<TABLE>, GROUP_BY_FIELDS extends TableFields<TABLE>[]> =
    [] extends GROUP_BY_FIELDS
        ? `${TableFields<TABLE> & string}${'' | ' asc' | ' desc'}`
        | `${TableFields<ArrayElementOf<QueryResultByFields<TABLE, FIELD>>> & string}${'' | ' asc' | ' desc'}`
        : `${(TableFields<AliasResult<TABLE, ArrayElementOf<FIELD>>> | ArrayElementOf<GROUP_BY_FIELDS>) & string}${'' | ' asc' | ' desc'}`

type FieldsWithAlias<SELECTIONS> = {
    [F in SELECTIONS & string]: F extends `${infer LEFT} as ${infer ALIAS}`
        ? LEFT extends `${AggFun}(${infer Field | `distinct ${infer Field}`})`
            ? Field
            : LEFT
        : never
}[SELECTIONS & string]

type SelectionsWithAlias<SELECTIONS> = {
    [F in SELECTIONS & string]: F extends `${infer OriginField} as ${infer ALIAS}`
        ? F
        : never
}[SELECTIONS & string]

type AliasResult<TABLE extends Table, Fields> = UnionToIntersection<
    {
        [F in Fields & string]:
        F extends `${infer LEFT} as ${infer ALIAS}`
            ? LEFT extends `${infer AGG_FUN extends AggFun}(${infer FIELD | `distinct ${infer FIELD}`})`
                ? {
                    [s in ALIAS]:
                    AGG_FUN extends 'avg' | 'sum' | 'count'
                        ? number
                        : TABLE[FIELD]
                }
                : { [s in ALIAS]: TABLE[LEFT] }
            : {}
    }[Fields & string]
>

type QueryResultByFields<TABLE extends Table, SELECTIONS extends TableSelections<TABLE>, SELECTION = ArrayElementOf<SELECTIONS>> =
    ['*'] extends SELECTIONS
        ? TABLE[]
        : ['count(*)'] extends SELECTIONS
            ? Int
            : Array<
                UnionToIntersection<
                    {
                        [S in SELECTION & string]:
                        S extends `${infer FIELD_OR_AGG} as ${infer ALIAS}`
                            ? FIELD_OR_AGG extends `${infer AGG_FUN extends AggFun}(${infer FIELD | `distinct ${infer FIELD}`})`
                                ? {
                                    [s in ALIAS]:
                                    AGG_FUN extends 'avg' | 'sum' | 'count'
                                        ? number
                                        : TABLE[FIELD]
                                }
                                : { [s in ALIAS]: TABLE[FIELD_OR_AGG] }
                            : { [s in S]: TABLE[S] }
                    }[SELECTION & string]
                >
                // Pick<
                //     TABLE,
                //     Exclude<
                //         ArrayElementOf<FieldArr>,
                //         FieldsWithAlias<ArrayElementOf<FieldArr>> | SelectionsWithAlias<ArrayElementOf<FieldArr>>
                //     >
                // >
                // &
                // AliasResult<TABLE, ArrayElementOf<FieldArr>>
            >
// type c =  TableFields<T_USER>
// const cc:c = ['sum(distinct user_nickname) as ']
// type a = QueryResultByFields<T_USER,['sum(distinct user_nickname) as a']>
//</editor-fold>

//<editor-fold desc="multiple table join types">
type MultiTableSelections<ALL_TBs extends DictOf<Table>> =
    Array<
        MultiTableSqlField<ALL_TBs>
        | `${MultiTableGeneralSqlField<ALL_TBs>} as ${string}`
        | `${AggFun}(${MultiTableGeneralSqlField<ALL_TBs> | `distinct ${MultiTableGeneralSqlField<ALL_TBs>}`}) as ${string}`
    >
    | ['*']
    | [`count(*)`]

type MultiTableGeneralSqlField<TBs extends Record<string, Table>> = {
    [TBName in keyof TBs]: {
        [K in keyof TBs[TBName]]: `${TBName & string}.${K & string}`
    }[keyof TBs[TBName]]
}[keyof TBs]

type MultiTableStarSqlField<TBs extends Record<string, Table>> = {
    [TBName in keyof TBs]: `${TBName & string}.*`
}[keyof TBs]

type MultiTableSqlField<TBs extends Record<string, Table>> =
    MultiTableGeneralSqlField<TBs>
    | MultiTableStarSqlField<TBs>

type InnerJoinResultBySelectionWithoutStar<ALL_TBs extends Record<string, Table>, SELECTIONS extends string, JOIN_TYPE extends 'inner' | 'left'> =
    UnionToIntersection<{
        [S in SELECTIONS]:
        S extends `${infer AGG_FUN extends AggFun}(${`${infer ALIAS}.${infer FIELD}` | `distinct ${infer ALIAS}.${infer FIELD}`}) as ${infer FIELD_ALIAS}`
            ? JOIN_TYPE extends 'inner'
                ? AGG_FUN extends 'avg' | 'sum' | 'count' ? Record<FIELD_ALIAS, number> : Record<FIELD_ALIAS, ALL_TBs[ALIAS][FIELD]>
                : AGG_FUN extends 'avg' | 'sum' | 'count' ? NullableDictOf<Record<FIELD_ALIAS, number>> : NullableDictOf<Record<FIELD_ALIAS, ALL_TBs[ALIAS][FIELD]>>
            : S extends `${infer ALIAS}.${infer FIELD} as ${infer FIELD_ALIAS}`
                ? JOIN_TYPE extends 'inner'
                    ? Record<FIELD_ALIAS, ALL_TBs[ALIAS][FIELD]>
                    : NullableDictOf<Record<FIELD_ALIAS, ALL_TBs[ALIAS][FIELD]>>
                : S extends `${infer ALIAS}.${infer FIELD}`
                    ? FIELD extends '*'
                        ? never
                        : JOIN_TYPE extends 'inner'
                            ? Record<FIELD, ALL_TBs[ALIAS][FIELD]>
                            : NullableDictOf<Record<FIELD, ALL_TBs[ALIAS][FIELD]>>
                    : never
    }[SELECTIONS]>

type InnerJoinResultByStarSelection<ALL_TBs extends Record<string, Table>, SELECTIONS extends string, JOIN_TYPE extends 'inner' | 'left'> =
    UnionToIntersection<{
        [K in SELECTIONS]:
        K extends `${infer ALIAS}.*`
            ? JOIN_TYPE extends 'inner' ? ALL_TBs[ALIAS] : NullableDictOf<ALL_TBs[ALIAS]>
            : never
    }[SELECTIONS]>

type InnerJoinResultBySelection<ALL_TBs extends Record<string, Table>, SELECTION extends string>
    =
    InnerJoinResultBySelectionWithoutStar<ALL_TBs, SELECTION, 'inner'>
    & InnerJoinResultByStarSelection<ALL_TBs, SELECTION, 'inner'>

type LeftJoinResultBySqlFields<ALL_TBs extends Record<string, Table>, SELECTIONS extends string>
    =
    InnerJoinResultBySelectionWithoutStar<ALL_TBs, SELECTIONS, 'left'>
    & InnerJoinResultByStarSelection<ALL_TBs, SELECTIONS, 'left'>

type JoinTBs<JOIN_TB_SQL_EXPR extends string, CUR_TBs extends Record<string, Table>, ALL_TBs extends Record<string, Table>> =
    JOIN_TB_SQL_EXPR extends `${infer JOIN_TB_NAME_ACTUAL} as ${infer ALIAS}`
        ? Record<ALIAS, ALL_TBs[JOIN_TB_NAME_ACTUAL]> & CUR_TBs
        : Record<JOIN_TB_SQL_EXPR, ALL_TBs[JOIN_TB_SQL_EXPR]> & CUR_TBs

type InnerJoinResultBySelections<TBs extends Record<string, Table>, RTBs extends Record<string, Table>, Selections extends MultiTableSelections<TBs & RTBs>> =
    ['*'] extends Selections
        ? UnionToIntersection<TBs[keyof TBs]>
        : InnerJoinResultBySelection<TBs, ArrayElementOf<Selections>>

type LeftJoinResultBySelections<TBs extends Record<string, Table>, RTBs extends Record<string, Table>, Fields extends MultiTableSelections<TBs & RTBs>> =
    ['*'] extends Fields
        ? UnionToIntersection<Partial<RTBs[keyof RTBs]>>
        : LeftJoinResultBySqlFields<RTBs, ArrayElementOf<Fields>>

type JoinResultBySqlSelections<TBs extends DictOf<Table>, RTBs extends DictOf<Table>, Fields extends MultiTableSelections<TBs & RTBs>> =
    ['count(*)'] extends Fields
        ? Int
        : Array<InnerJoinResultBySelections<TBs, RTBs, Fields> & LeftJoinResultBySelections<TBs, RTBs, Fields>>
//</editor-fold>

//<editor-fold desc="command booter">
export class CommandBooter<TABLE extends Table, TBName extends string, ALL_TBs extends DictOf<Table>> {
    constructor(private table: string, private pool: Pool) {
    }

    as<ALIAS extends string>(alias: ALIAS): MultiTableCommandBooter<Record<ALIAS, TABLE>, {}, ALL_TBs> {
        return new MultiTableCommandBooter(this.pool, { [alias]: this.table })
    }

    join<JoinTBName extends keyof ALL_TBs | `${keyof ALL_TBs & string} as ${string}`>(tbName: JoinTBName)
        : MultiTableCommandBooter<JoinTBs<JoinTBName & string, Record<TBName, TABLE>, ALL_TBs>, {}, ALL_TBs> {
        const [tbNameActual, alias] = tbName.toString().split(' as ')
        return new MultiTableCommandBooter(this.pool, {
            [this.table]: this.table,
            [alias ?? tbNameActual]: tbNameActual
        }) as any
    }

    leftJoin<JoinTBName extends keyof ALL_TBs | `${keyof ALL_TBs & string} as ${string}`>(tbName: JoinTBName)
        : MultiTableCommandBooter<Record<TBName, TABLE>, JoinTBs<JoinTBName & string, {}, ALL_TBs>, ALL_TBs> {
        const [tbNameActual, alias] = tbName.toString().split(' as ')
        return new MultiTableCommandBooter(this.pool, { [this.table]: this.table }, { [alias ?? tbNameActual]: tbNameActual }) as any
    }

    count(): QueryCommand<TABLE, ['count(*)']> {
        return this.select('count(*)')
    }

    // select<Fields extends Array<keyof TABLE>>(...fields: Fields): QueryCommand<TABLE, QueryResultByFields<TABLE, Fields>>
    // select<Fields extends ['*'] | ['count(*)']>(...fields: Fields): QueryCommand<TABLE, QueryResultByFields<TABLE, Fields>>
    select<F extends TableSelections<TABLE> | ['*'] | ['count(*)']>(...fields: F): QueryCommand<TABLE, F> {
        return new QueryCommand<TABLE, F>(this.table, this.pool).select(...fields as any) as any
    }

    update(updateData: Partial<TABLE>): UpdateCommand<TABLE> {
        const dataWithoutUndef = withoutUndefined(updateData)
        return new UpdateCommand<TABLE>(this.table, this.pool).set(dataWithoutUndef)
    }

    delete(): DeleteCommand<TABLE> {
        return new DeleteCommand<TABLE>(this.table, this.pool)
    }

    insert(data: TABLE): InsertCommand<TABLE> {
        const dataWithoutUndef = withoutUndefined(data)
        return new InsertCommand<TABLE>(this.table, this.pool).values(dataWithoutUndef)
    }
}

export class MultiTableCommandBooter<TBs extends DictOf<Table>, RTBs extends DictOf<Table>, ALL_TBs extends DictOf<Table>> {
    private _on?: ConditionExpr

    constructor(private _pool: QueryHelper, private _tableAlias: DictOf<string>, private _rightTableAlias?: DictOf<string>) {
    }

    join<JoinTBName extends keyof ALL_TBs | `${keyof ALL_TBs & string} as ${string}`>(tbName: JoinTBName)
        : MultiTableCommandBooter<JoinTBs<JoinTBName & string, TBs, ALL_TBs>, RTBs, ALL_TBs> {
        const [tbNameActual, alias] = tbName.toString().split(' as ')
        this._tableAlias = { ...this._tableAlias, [alias ?? tbNameActual]: tbNameActual }
        return this as any
    }

    leftJoin<JoinTBName extends keyof ALL_TBs | `${keyof ALL_TBs & string} as ${string}`>(tbName: JoinTBName)
        : MultiTableCommandBooter<TBs, JoinTBs<JoinTBName & string, RTBs, ALL_TBs>, ALL_TBs> {
        const [tbNameActual, alias] = tbName.toString().split(' as ')
        this._rightTableAlias = { ...this._rightTableAlias, [alias ?? tbNameActual]: tbNameActual }
        return this as any
    }

    on(ebProvider: MultiTableConditionExprBuilderProvider<TBs & RTBs, {}>): this {
        const newExpr = invokeMultiTableConditionExprBuilderProvider(ebProvider)
        if (newExpr) {
            if (!this._on) {
                this._on = newExpr
            } else {
                this._on = {
                    type: 'and',
                    exprs: [this._on, newExpr]
                }
            }
        }
        return this
    }

    count(): MultiTableQueryCommand<TBs, RTBs, ['count(*)']> {
        return this.select('count(*)')
    }

    // select<Fields extends Array<MultiTableSqlFields<TBs & RTBs>> /*| '*' | 'count(*)'*/>(...fields: Fields): MultiTableQueryCommand<TBs, RTBs, JoinResultBySqlFields<TBs, RTBs, Fields>>;
    // select<Fields extends ['*'] | ['count(*)']>(...fields: Fields): MultiTableQueryCommand<TBs, RTBs, JoinResultBySqlFields<TBs, RTBs, Fields>>;
    select<F extends MultiTableSelections<TBs & RTBs>>(...fields: F): MultiTableQueryCommand<TBs, RTBs, F> {
        const cmd = new MultiTableQueryCommand<TBs, RTBs, F>(this._pool, this._tableAlias, this._rightTableAlias, this._on)
        return cmd.select(...fields as any) as any
    }
}

//</editor-fold>

abstract class SqlCommand<TABLE extends Table, CMD_RESULT> {
    constructor(protected table: string) {
    }

    abstract exec(): Promise<CMD_RESULT>
}

abstract class SqlConditionalCommand<TABLE extends Table, CMD_RESULT, TBs extends Record<string, Table> | undefined = undefined> extends SqlCommand<TABLE, CMD_RESULT> {

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

type SelectedField = {
    fun?: AggFun
    fieldName: string
    alias?: string
}

export class QueryCommand<
    TABLE extends Table,
    FIELD extends TableSelections<TABLE> = ['*'],
    GROUP_BY_FIELDS extends TableFields<TABLE>[] = []
> extends SqlConditionalCommand<TABLE, QueryResultByFields<TABLE, FIELD>> {
    private havingConditionExpr?: ConditionExpr = undefined
    private _select?: TableSelections<TABLE> = ['*']

    private _limit?: number | [number, number]

    private _orderBy?: MaybeArray<OrderBy<TABLE, FIELD, GROUP_BY_FIELDS>>
    private _groupBy?: Array<TableFields<TABLE>>

    constructor(table: string, private _pool: QueryHelper) {
        super(table)
    }

    // select<Fields extends Array<Exclude<keyof TABLE, 'count(*)' | '*'>>>(...fields: Fields): QueryCommand<TABLE, QueryResultByFields<TABLE, Fields>>
    // select<Fields extends ['*'] | ['count(*)']>(...fields: Fields): QueryCommand<TABLE, QueryResultByFields<TABLE, Fields>>
    select<F extends TableSelections<TABLE>>(...fields: F): QueryCommand<TABLE, F> {
        this._select = fields
        return this as any
    }

    count(): QueryCommand<TABLE, ['count(*)']> {
        this._select = ['count(*)']
        return this as any
    }

    limit(l1: number, l2?: number): this {
        if (l2 != null) {
            this._limit = [l1, l2]
        } else {
            this._limit = l1
        }
        return this
    }

    groupBy<GB extends Array<TableFields<TABLE>>>(...gb: GB)
        : QueryCommand<TABLE, FIELD, GB> {
        this._groupBy = gb
        return this as QueryCommand<TABLE, FIELD, GB>
    }

    having(exprBuilderProvider:
               ConditionExprBuilderProvider<
                   ArrayElementOf<QueryResultByFields<TABLE, FIELD>>
                   & Pick<TABLE, ArrayElementOf<GROUP_BY_FIELDS>>
               >
               | undefined
    ): this {
        if (!exprBuilderProvider) {
            this.havingConditionExpr = undefined
            return this
        }
        this.havingConditionExpr = invokeConditionExprBuilderProvider(exprBuilderProvider)
        return this
    }

    orderBy(ob: MaybeArray<OrderBy<TABLE, FIELD, GROUP_BY_FIELDS>>): this {
        this._orderBy = ob
        return this
    }

    private escapeOrderBy(ob: OrderBy<TABLE, FIELD, GROUP_BY_FIELDS>): string {
        const [field, order] = ob.split(' ')
        return `${escapeSqlFieldExpr(field, this._pool)}${order ? ` ${order}` : ''}`
    }

    exec(): Promise<QueryResultByFields<TABLE, FIELD>> {
        let sql = `select`
        const selectedFields = this._select
        const firstField = selectedFields?.[0]
        const fieldsSql = firstField !== '*' && firstField !== 'count(*)' && selectedFields?.isNotEmpty()
            ? selectedFields.map(it => escapeSqlFieldExpr(it.toString(), this._pool)).join(',')
            : firstField?.toString()
        sql += ` ${fieldsSql} from ${this._pool.escapeId(this.table)} `

        let params: Record<string, any> | undefined = undefined
        if (this.conditionExpr) {
            params ??= {}
            const whereExprSql = this.conditionExpr && parseMysqlExpr(this.conditionExpr, params, this._pool)
            sql += ` where ${whereExprSql} `
        }
        // group by
        if (this._groupBy && this._groupBy.isNotEmpty()) {
            sql += ` group by ${this._groupBy.map(gb => this._pool.escapeId(gb.toString())).join(',')} `
        }
        // having
        if (this.havingConditionExpr) {
            params ??= {}
            const havingExprSql = this.havingConditionExpr && parseMysqlExpr(this.havingConditionExpr, params, this._pool)
            sql += ` having ${havingExprSql} `
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
        return execSql(this._pool, sql, params)
            .then(rs => {
                if (selectedFields?.[0] === 'count(*)') {
                    return rs[0]['count(*)']
                }
                return rs
            })
    }

    execTakeFirst(): Promise<QueryResultByFields<TABLE, FIELD> extends Int ? Int : ArrayElementOf<QueryResultByFields<TABLE, FIELD>> | undefined> {
        return this.exec()
            .then(rs => {
                if (Array.isArray(rs)) {
                    return rs[0]
                }
                return rs as any
            })
    }
}

type MultiTableFieldsByFieldsExpr<TB_ALIAS, FIELDS_EXPR> = {
    [FE in FIELDS_EXPR & string]: FE extends `${TB_ALIAS & string}.${infer F}`
        ? FE extends `${TB_ALIAS & string}.${infer F} as ${string}`
            ? never
            : F
        : never
}[FIELDS_EXPR & string]

type MultiTableQueryHavingClause4TBsPart<
    ALL_TBs extends DictOf<Table>,
    FIELDS extends MultiTableSelections<ALL_TBs>,
    GROUP_BY_FIELDS extends MultiTableSqlField<ALL_TBs>[]
> = FIELDS extends ['*']
    ? ALL_TBs
    : FIELDS extends ['count(*)']
        ? {}
        : UnionToIntersection<
            {
                [TB_ALIAS in keyof ALL_TBs]-?: `${TB_ALIAS & string}.*` extends ArrayElementOf<FIELDS>
                ? ALL_TBs[TB_ALIAS]
                : MultiTableFieldsByFieldsExpr<TB_ALIAS, ArrayElementOf<FIELDS> | ArrayElementOf<GROUP_BY_FIELDS>> extends never
                    ? never
                    : Record<TB_ALIAS, Pick<ALL_TBs[TB_ALIAS], MultiTableFieldsByFieldsExpr<TB_ALIAS, ArrayElementOf<FIELDS> | ArrayElementOf<GROUP_BY_FIELDS>>>>
            }[keyof ALL_TBs]
        >

type MultiTableQueryHavingClauseAliasPart<
    ALL_TBs extends DictOf<Table>,
    SELECTIONS extends MultiTableSelections<ALL_TBs>,
    GROUP_BY_FIELDS extends MultiTableSqlField<ALL_TBs>[]
> = SELECTIONS extends ['*']
    ? ALL_TBs
    : SELECTIONS extends ['count(*)']
        ? {}
        : UnionToIntersection<
            {
                [K in ArrayElementOf<SELECTIONS>]:
                K extends `${infer AGG_FUN extends AggFun}(${`${infer ALIAS}.${infer FIELD}` | `distinct ${infer ALIAS}.${infer FIELD}`}) as ${infer FIELD_ALIAS}`
                    ? AGG_FUN extends 'avg' | 'sum' | 'count'
                        ? Record<FIELD_ALIAS, number>
                        : Record<FIELD_ALIAS, ALL_TBs[ALIAS][FIELD]>
                    : K extends `${infer ALIAS}.${infer FIELD} as ${infer FIELD_ALIAS}`
                        ? Record<FIELD_ALIAS, ALL_TBs[ALIAS][FIELD]>
                        : {}
            }[ArrayElementOf<SELECTIONS>]
        >

type MultiTableOrderByWithoutGroupBy<TBs extends Record<string, Table>, FIELDS = MultiTableGeneralSqlField<TBs>> =
    FIELDS | `${FIELDS & string} asc` | `${FIELDS & string} desc`

type MultiTableOrderBy<
    ALL_TBs extends DictOf<Table>,
    FIELDS extends MultiTableSelections<ALL_TBs>,
    GROUP_BY_FIELDS extends MultiTableSqlField<ALL_TBs>[],
    GROUP_BY_FIELD = ArrayElementOf<GROUP_BY_FIELDS>
> = GROUP_BY_FIELDS extends []
    ? MultiTableOrderByWithoutGroupBy<ALL_TBs, FIELDS>
    : {
        [K in ArrayElementOf<FIELDS>]:
        K extends `${infer AGG_FUN extends AggFun}(${`${infer TB_ALIAS}.${infer FIELD}` | `distinct ${infer TB_ALIAS}.${infer FIELD}`}) as ${infer FIELD_ALIAS}`
            ? FIELD_ALIAS | `${FIELD_ALIAS} asc` | `${FIELD_ALIAS} desc`
            : K extends `${infer ALIAS}.${infer FIELD} as ${infer FIELD_ALIAS}`
                ? FIELD_ALIAS | `${FIELD_ALIAS} asc` | `${FIELD_ALIAS} desc`
                : K extends `${infer ALIAS}.${infer FIELD}`
                    ? FIELD extends '*'
                        ? never
                        : K | `${K} asc` | `${K} desc`
                    : never
    }[ArrayElementOf<FIELDS>]
    | `${GROUP_BY_FIELD & string}`
    | `${GROUP_BY_FIELD & string} asc`
    | `${GROUP_BY_FIELD & string} desc`

class MultiTableQueryCommand<
    TBs extends DictOf<Table>,
    RTBs extends DictOf<Table>,
    FIELDS extends MultiTableSelections<TBs & RTBs>,
    GROUP_BY_FIELDS extends MultiTableSqlField<TBs & RTBs>[] = []
> {
    protected conditionExpr?: ConditionExpr = undefined
    protected havingConditionExpr?: ConditionExpr = undefined

    private _select: MultiTableSelections<TBs & RTBs> = ['*']

    private _limit?: number | [number, number]

    private _orderBy?: MaybeArray<MultiTableOrderBy<TBs & RTBs, FIELDS, GROUP_BY_FIELDS>>

    private _groupBy?: MultiTableGeneralSqlField<TBs & RTBs>[]

    constructor(private _pool: QueryHelper, private _tableAlias: DictOf<string>, private _rightTableAlias?: DictOf<string>, private _on?: ConditionExpr,) {
    }

    where(exprBuilderProvider: MultiTableConditionExprBuilderProvider<TBs & RTBs, {}>): this {
        if (!exprBuilderProvider) {
            this.conditionExpr = undefined
            return this
        }
        this.conditionExpr = invokeMultiTableConditionExprBuilderProvider(exprBuilderProvider)
        return this
    }

    and(exprBuilderProvider: MultiTableConditionExprBuilderProvider<TBs & RTBs, {}>): this {
        const newExpr = invokeMultiTableConditionExprBuilderProvider(exprBuilderProvider)
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

    or(exprBuilderProvider: MultiTableConditionExprBuilderProvider<TBs & RTBs, {}>): this {
        const newExpr = invokeMultiTableConditionExprBuilderProvider(exprBuilderProvider)
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

    not(exprBuilderProvider: MultiTableConditionExprBuilderProvider<TBs & RTBs, {}>): this {
        const newExpr = invokeMultiTableConditionExprBuilderProvider(exprBuilderProvider)
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

    // select<Fields extends Array<MultiTableSqlFields<TBs & RTBs>> /*| '*' | 'count(*)'*/>(...fields: Fields): MultiTableQueryCommand<TBs, RTBs, JoinResultBySqlFields<TBs, RTBs, Fields>>;
    // select<Fields extends ['*'] | ['count(*)']>(...fields: Fields): MultiTableQueryCommand<TBs, RTBs, JoinResultBySqlFields<TBs, RTBs, Fields>>;
    select<F extends Array<MultiTableSqlField<TBs & RTBs>> | ['*'] | ['count(*)']>(...fields: F): MultiTableQueryCommand<TBs, RTBs, F> {
        this._select = fields
        return this as any
    }

    count(): MultiTableQueryCommand<TBs, RTBs, ['count(*)']> {
        return this.select('count(*)')
    }

    groupBy<GB extends MultiTableGeneralSqlField<TBs & RTBs>[]>(...gb: GB)
        : MultiTableQueryCommand<TBs, RTBs, FIELDS, GB> {
        this._groupBy = gb
        return this as MultiTableQueryCommand<TBs, RTBs, FIELDS, GB>
    }

    having(exprBuilderProvider:
               MultiTableConditionExprBuilderProvider<
                   MultiTableQueryHavingClause4TBsPart<TBs & RTBs, FIELDS, GROUP_BY_FIELDS>,
                   MultiTableQueryHavingClauseAliasPart<TBs & RTBs, FIELDS, GROUP_BY_FIELDS>
               >
    ): this {
        if (!exprBuilderProvider) {
            this.havingConditionExpr = undefined
            return this
        }
        const aggWithAliasExtractor = /(\S{1,})\((distinct |)(\S{1,})\) as (\S{1,})/
        const withAliasExtractor = /(\S{1,}) as (\S{1,})/
        const aliasFields = this._select?.mapNotNull(selection => {
            const aggWithAlias = aggWithAliasExtractor.exec(selection)
            if (aggWithAlias && aggWithAlias.input == aggWithAlias[0]) {
                return aggWithAlias[4]
            }
            const withAlias = withAliasExtractor.exec(selection)
            if (withAlias && withAlias.input == withAlias[0]) {
                return withAlias[2]
            }
            return undefined
        })
        this.havingConditionExpr = invokeMultiTableConditionExprBuilderProvider(exprBuilderProvider, aliasFields)
        return this
    }

    limit(l1: number, l2?: number): this {
        if (l2 != null) {
            this._limit = [l1, l2]
        } else {
            this._limit = l1
        }
        return this
    }

    orderBy(ob: MaybeArray<MultiTableOrderBy<TBs & RTBs, FIELDS, GROUP_BY_FIELDS>>): this {
        this._orderBy = ob
        return this
    }

    private escapeOrderBy(ob: MultiTableOrderBy<TBs & RTBs, FIELDS, GROUP_BY_FIELDS>): string {
        const [fieldExpr, order] = ob.split(' ')
        return `${escapeSqlFieldExpr(fieldExpr, this._pool)}${order ? ` ${order}` : ''}`
    }

    private escapeTables() {
        const innerJoin = Object.entries(this._tableAlias)
            .map(([alias, tbName]) => {
                return `${this._pool.escapeId(tbName)} as ${this._pool.escapeId(alias)}`
            })
            .join(' inner join ')
        if (this._rightTableAlias) {
            return innerJoin
                + ' left join '
                + Object.entries(this._rightTableAlias)
                    .map(([alias, tbName]) => {
                        return `${this._pool.escapeId(tbName)} as ${this._pool.escapeId(alias)}`
                    })
                    .join(' left join ')
        }
        return innerJoin
    }

    private buildExecData() {
        let sql = `select`
        const selectedFields = this._select
        const firstField = selectedFields?.[0]
        const fieldsSql = firstField !== '*' && firstField !== 'count(*)' && selectedFields.isNotEmpty()
            ? selectedFields.map(it => escapeSqlFieldExpr(it.toString(), this._pool)).join(',')
            : firstField
        sql += ` ${fieldsSql} from ${this.escapeTables()} `
        const params: Record<string, any> | undefined = {}
        if (this._on) {
            const onExprSql = parseMysqlExpr(this._on, params, this._pool)
            sql += ` on ${onExprSql} `
        }
        if (this.conditionExpr) {
            const whereExprSql = parseMysqlExpr(this.conditionExpr, params, this._pool)
            sql += ` where ${whereExprSql} `
        }

        // group by
        if (this._groupBy && this._groupBy.isNotEmpty()) {
            sql += ` group by ${this._groupBy.map(gb => this._pool.escapeId(gb.toString())).join(',')} `
        }
        // having
        if (this.havingConditionExpr) {
            const havingExprSql = this.havingConditionExpr && parseMysqlExpr(this.havingConditionExpr, params, this._pool)
            sql += ` having ${havingExprSql} `
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
        return { sql, selectedFields, params }
    }

    exec(): Promise<JoinResultBySqlSelections<TBs, RTBs, FIELDS>> {
        const { sql, selectedFields, params } = this.buildExecData()
        return execSql(this._pool, sql, params)
            .then(rs => {
                if (selectedFields?.firstOrUndefined() == 'count(*)') {
                    return rs[0]['count(*)']
                }
                return rs
            })
    }

    execTakeFirst(): Promise<JoinResultBySqlSelections<TBs, RTBs, FIELDS> extends Int ? Int : ArrayElementOf<JoinResultBySqlSelections<TBs, RTBs, FIELDS>> | undefined> {
        return this.exec()
            .then(rs => {
                if (Array.isArray(rs)) {
                    return rs[0]
                }
                return rs as any
            })
    }
}

export class UpdateCommand<TABLE extends Table> extends SqlConditionalCommand<TABLE, MysqlModifyResult> {
    private _updateData?: Partial<TABLE> = undefined

    constructor(table: string, private _pool: QueryHelper) {
        super(table)
    }

    set(updateData: Partial<TABLE>): this {
        this._updateData = updateData
        return this
    }

    exec(): Promise<MysqlModifyResult> {
        const data = this._updateData
        if (!data) {
            throw Error('nothing to update')
        }
        if (!this.conditionExpr) {
            throw Error(`can't update without condition`)
        }
        const params = {}
        const paramNameUpdate = putNewParam(params, 'record', data, this._pool)
        const whereSql = parseMysqlExpr(this.conditionExpr, params, this._pool)

        let sql = `update ${this._pool.escapeId(this.table)} `
        sql += ` set ${paramNameUpdate} `
        sql += ` where ${whereSql}`
        return execSql(this._pool, sql, params)
    }
}

export class DeleteCommand<TABLE extends Table> extends SqlConditionalCommand<TABLE, MysqlModifyResult> {

    constructor(table: string, private _pool: QueryHelper) {
        super(table)
    }

    exec(): Promise<MysqlModifyResult> {
        if (!this.conditionExpr) {
            throw Error(`can't delete without condition`)
        }
        const params = {}
        const whereSql = parseMysqlExpr(this.conditionExpr, params, this._pool)
        const sql = `delete
                     from ${this._pool.escapeId(this.table)}
                     where ${whereSql}`
        return execSql(this._pool, sql, params)
    }
}

export class InsertCommand<TABLE extends Table> extends SqlCommand<TABLE, MysqlModifyResult> {
    private newData?: TABLE = undefined
    private data4Updating?: Partial<TABLE> = undefined

    constructor(table: string, private _pool: QueryHelper) {
        super(table)
    }

    values(data: TABLE): this {
        this.newData = data
        return this
    }

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
        const paramNameInsert = putNewParam(params, `record`, data, this._pool)
        let sql = `insert into ${this._pool.escapeId(this.table)}
                   set ${paramNameInsert} `
        if (data4Updating) {
            const paramNameUpdate = putNewParam(params, `record`, data4Updating, this._pool)
            sql += ` on duplicate key update ${paramNameUpdate} `
        }
        return execSql(this._pool, sql, params)
    }
}

export function execSql(queryHelper: {
    query: QueryFunction
}, sql: string, params?: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
        console.debug(`exec sql = ${sql}`)
        // log.debug({ title: 'mysql', msg: `params = ${JSON.stringify(params)}` })
        queryHelper.query(sql, params, (err: MysqlError | null, results?: any) => {
            if (err) {
                reject(err)
            } else {
                resolve(results)
            }
        })
    })
}
