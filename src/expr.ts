import { PlainValueWithoutArr,Table } from './types'
import { QueryHelper } from './types'

//<editor-fold desc="condition expr types">
export type ConditionExpr = LogicExpr | FieldExpr
export type LogicExpr = ExprAnd | ExprOr | ExprNot

interface ExprAnd {
    type: 'and'
    exprs: Array<ConditionExpr>
}

interface ExprOr {
    type: 'or'
    exprs: Array<ConditionExpr>
}

interface ExprNot {
    type: 'not'
    expr: ConditionExpr
}

export class ConditionExprBuilder {
    constructor(private expr: ConditionExpr) {
    }

    and(builder: ConditionExprBuilder): ConditionExprBuilder {
        return new ConditionExprBuilder({ type: 'and', exprs: [this.expr, builder.expr] })
    }

    or(builder: ConditionExprBuilder): ConditionExprBuilder {
        return new ConditionExprBuilder({ type: 'or', exprs: [this.expr, builder.expr] })
    }

    not(): ConditionExprBuilder {
        return new ConditionExprBuilder({ type: 'not', expr: this.expr })
    }

    build(): ConditionExpr {
        return this.expr
    }

    toJson(): string {
        return JSON.stringify(this.expr)
    }
}

//</editor-fold>

//<editor-fold desc="field expr">
export type CompareOperatorSymbol = FieldExpr['op']

type FieldExpr = {
    type: 'field_compare'
    table?: string
    field: string
} & (
    {
        op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
        value: PlainValueWithoutArr | FieldExprBuilder
    }
    |
    {
        op: 'in', value: any[] | FieldExprBuilder[]
    }
    )

type FieldExprBuilderOf<FIELD_TYPE, DATA> = {
    [key in CompareOperatorSymbol]: (value: key extends 'in' ? Array<FIELD_TYPE | FieldExprBuilderOf<FIELD_TYPE, DATA> | null> : FIELD_TYPE | null | FieldExprBuilderOf<FIELD_TYPE, DATA>) => ConditionExprBuilder
}
export type TableFieldExprBuilderBooter<TABLE> = {
    [K in keyof TABLE]-?: FieldExprBuilderOf<TABLE[K], TABLE>
}
export type MultiTableFieldExprBuilderBooter<TBs, ALIAS_PART_OF_RESULT> = {
    [TBName in keyof TBs]: TableFieldExprBuilderBooter<TBs[TBName]>
} & TableFieldExprBuilderBooter<ALIAS_PART_OF_RESULT>
//</editor-fold>

//<editor-fold desc="field expr builder">
class FieldExprBuilder0 {
    constructor(public table: string) {
    }

    field(f: string): FieldExprBuilder {
        return new FieldExprBuilder(f, this.table)
    }
}

class FieldExprBuilder implements FieldExprBuilderOf<any, any> {
    public readonly field: string
    public readonly table?: string

    constructor(field: string, table?: string) {
        this.field = field
        this.table = table
    }

    eq(value: any): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'eq',
            field: this.field,
            table: this.table,
            value: value
        })
    }

    gt(value: any): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'gt',
            field: this.field,
            table: this.table,
            value: value
        })
    }

    gte(value: any): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'gte',
            field: this.field,
            table: this.table,
            value: value
        })
    }

    in(values: any[]): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'in',
            field: this.field,
            table: this.table,
            value: values
        })
    }

    lt(value: any): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'lt',
            field: this.field,
            table: this.table,
            value: value
        })
    }

    lte(value: any): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'lte',
            field: this.field,
            table: this.table,
            value: value
        })
    }

    ne(value: any): ConditionExprBuilder {
        return new ConditionExprBuilder({
            type: 'field_compare',
            op: 'ne',
            field: this.field,
            table: this.table,
            value: value
        })
    }
}

const FIELD_EXPR_STARTER = { _symbol: Symbol() }

const TABLE_EXPR_STARTER = { _symbol: Symbol() }

function getExprStarterProxy(target: Record<string, any>, aliasFields?: string[]): any {
    return new Proxy(target, {
        get: function (target, prop) {
            const strProp = prop.toString()
            if (target === TABLE_EXPR_STARTER) {
                if (aliasFields?.includes(strProp)) {
                    return getExprStarterProxy(new FieldExprBuilder(strProp))
                }
                return new Proxy(new FieldExprBuilder0(strProp), {
                    get(target: FieldExprBuilder0, p: string | symbol, receiver: any): any {
                        return target.field(p.toString())
                    }
                })
            }
            if (target === FIELD_EXPR_STARTER) {
                return getExprStarterProxy(new FieldExprBuilder(strProp))
            }
            if (strProp === 'in') {
                return (values: any[]) => {
                    return (target as FieldExprBuilder).in(values)
                }
            } else {
                return (value: any) => {
                    return (target as any)[strProp](value)
                }
            }
        }
    })

}

const fieldExprBuilderBooter = getExprStarterProxy(FIELD_EXPR_STARTER as any as Record<string, any>) as TableFieldExprBuilderBooter<any>

const multiTableFieldExprBuilderBooter = getExprStarterProxy(TABLE_EXPR_STARTER as any as Record<string, any>) as MultiTableFieldExprBuilderBooter<any, any>

function makeMultiTableFieldExprBuilderBooter(aliasFields?: string[]): MultiTableFieldExprBuilderBooter<any, any> {
    if (!aliasFields || aliasFields.isEmpty()) {
        return multiTableFieldExprBuilderBooter
    }
    return getExprStarterProxy(TABLE_EXPR_STARTER as any as Record<string, any>, aliasFields) as MultiTableFieldExprBuilderBooter<any, any>
}

//</editor-fold>

//<editor-fold desc="condition expr parser">
function extractSafeSqlFieldExpr(fieldInfo: { field: string, table?: string }, queryHelper: QueryHelper) {
    return escapeSqlFieldExpr(
        fieldInfo.table
            ? `${fieldInfo.table}.${fieldInfo.field}`
            : fieldInfo.field,
        queryHelper
    )
}

export function escapeSqlFieldExpr(f: string, queryHelper: QueryHelper): string {
    const aggWithAlias = /(\S{1,})\((distinct |)(\S{1,})\) as (\S{1,})/.exec(f)
    if (aggWithAlias && aggWithAlias.input == aggWithAlias[0]) {
        return `${aggWithAlias[1]}(${aggWithAlias[2] ? aggWithAlias[2] + ' ' : ''}${escapeSqlField(aggWithAlias[3], queryHelper)}) as ${queryHelper.escapeId(aggWithAlias[4])}`
    }
    const withAlias = /(\S{1,}) as (\S{1,})/.exec(f)
    if (withAlias && withAlias.input == withAlias[0]) {
        return `${escapeSqlField(withAlias[1], queryHelper)} as ${queryHelper.escapeId(withAlias[2])}`
    }
    return escapeSqlField(f, queryHelper)
    // const [alias, field] = f.split('.')
    // if (!field) {
    //     return queryHelper.escapeId(alias)
    // }
    // return `${queryHelper.escapeId(alias)}.${field === '*' ? field : queryHelper.escapeId(field)}`
}

function escapeSqlField(f: string, queryHelper: QueryHelper): string {
    const [alias, field] = f.split('.')
    if (!field) {
        return queryHelper.escapeId(alias)
    }
    return `${queryHelper.escapeId(alias)}.${field === '*' ? field : queryHelper.escapeId(field)}`
}

/**
 *
 * @param params
 * @param fieldName
 * @param paramValue
 *
 * return param name
 */
export function putNewParam(params: Record<string, any>, fieldName: string, paramValue: FieldExpr['value'], queryHelper: QueryHelper): string {
    if (paramValue instanceof FieldExprBuilder) {
        return extractSafeSqlFieldExpr(paramValue, queryHelper)
    }
    const namePrefix = `__`
    const nameSuffix = `__`
    const names = Object.keys(params)
    const existsCnt = names.count(it => it.startsWith(`${namePrefix}${fieldName}`))
    const newParamName = `${namePrefix}${fieldName}${nameSuffix}${existsCnt}`
    params[newParamName] = paramValue
    return ':' + newParamName
}

export function parseMysqlExpr(expr: ConditionExpr, outParams: Record<string, any>, pool: QueryHelper): string {
    let sql = ` ( `
    switch (expr.type) {
        case 'and':
            sql += expr.exprs
                .map(it => parseMysqlExpr(it, outParams, pool))
                .join(' and ')
            break
        case 'or':
            sql += expr.exprs
                .map(it => parseMysqlExpr(it, outParams, pool))
                .join(' or ')
            break
        case 'not':
            sql += `!${parseMysqlExpr(expr.expr, outParams, pool)}`
            break
        case 'field_compare':
            sql += parseMysqlCompareExpr(expr, outParams, pool)
            break
    }
    sql += ` ) `
    return sql
}

function parseMysqlCompareExpr(expr: FieldExpr, outParams: Record<string, any>, queryHelper: QueryHelper): string {
    const field = expr.field
    const value = expr.value
    let paramName = ''
    const fieldInSql = extractSafeSqlFieldExpr(expr, queryHelper)
    switch (expr.op) {
        case 'in':
            // const paramNames = []
            // for (let i = 0; i < expr.value.length; i++) {
            //     const paramName = putNewParam(outParams, expr.field, expr.value[i])
            //     paramNames.push(paramName)
            // }
            // return ` ${fieldInSql} in (${paramNames.join(',')}) `
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} in (${paramName})`
        case 'eq':
            if (value == null) {
                return `${fieldInSql} is null`
            }
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} = ${paramName}`
        case 'ne':
            if (value == null) {
                return `${fieldInSql} is not null`
            }
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} != ${paramName}`
        case 'gt':
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} > ${paramName}`
        case 'gte':
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} >= ${paramName}`
        case 'lt':
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} < ${paramName}`
        case 'lte':
            paramName = putNewParam(outParams, field, value, queryHelper)
            return `${fieldInSql} <= ${paramName}`
    }
}

export type ConditionExprBuilderProvider<TABLE> =
    ((expr: TableFieldExprBuilderBooter<TABLE>) => ConditionExprBuilder | ConditionExpr | undefined)
    | ConditionExprBuilder
    | ConditionExpr

export function invokeConditionExprBuilderProvider<TABLE extends Table>(provider: ConditionExprBuilderProvider<TABLE>): ConditionExpr | undefined {
    const exprOrBuilder = typeof provider === 'function'
        ? provider(fieldExprBuilderBooter as TableFieldExprBuilderBooter<TABLE>)
        : provider
    const expr = exprOrBuilder instanceof ConditionExprBuilder ? exprOrBuilder.build() : exprOrBuilder
    return expr
}

export type MultiTableConditionExprBuilderProvider<TBs, ALIAS_PART_OF_RESULT>
    =
    ((expr: MultiTableFieldExprBuilderBooter<TBs, ALIAS_PART_OF_RESULT>) => ConditionExprBuilder | ConditionExpr | undefined)
    | ConditionExprBuilder
    | ConditionExpr

export function invokeMultiTableConditionExprBuilderProvider<TBs, ALIAS_PART_OF_RESULT>(
    provider: MultiTableConditionExprBuilderProvider<TBs, ALIAS_PART_OF_RESULT>,
    aliasFields: string[] = []
): ConditionExpr | undefined {
    const exprOrBuilder = typeof provider === 'function'
        ? provider(makeMultiTableFieldExprBuilderBooter(aliasFields) as MultiTableFieldExprBuilderBooter<TBs, ALIAS_PART_OF_RESULT>)
        : provider
    const expr = exprOrBuilder instanceof ConditionExprBuilder ? exprOrBuilder.build() : exprOrBuilder
    return expr
}

//</editor-fold>