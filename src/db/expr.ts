import { Table } from './types'

export type ConditionExpr = LogicExpr | ExprField
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

export type CompareOperatorSymbol = ExprField['op']
type ExprField = {
    type: 'field_compare'
    field: string
} & (
    {
        op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'
        value: any
    }
    |
    {
        op: 'in', value: any[]
    }
    )

export class ExprBuilder<TB extends Table> {
    constructor(private expr: ConditionExpr) {
    }

    and(exprBuilder: ExprBuilder<TB>): ExprBuilder<TB> {
        return new ExprBuilder<TB>({ type: 'and', exprs: [this.expr, exprBuilder.expr] })
    }

    or(exprBuilder: ExprBuilder<TB>): ExprBuilder<TB> {
        return new ExprBuilder<TB>({ type: 'or', exprs: [this.expr, exprBuilder.expr] })
    }

    not(): ExprBuilder<TB> {
        return new ExprBuilder<TB>({ type: 'not', expr: this.expr })
    }

    build(): ConditionExpr {
        return this.expr
    }

    toJson(): string {
        return JSON.stringify(this.expr)
    }
}

type FieldExprBuilderOf<FIELD_TYPE, DATA extends Table> = {
    [key in CompareOperatorSymbol]: (value: key extends 'in' ? FIELD_TYPE[] : FIELD_TYPE | null) => ExprBuilder<DATA>
} /*& {
    [key in 'in']: (...values: FIELD_TYPE[]) => ExprBuilder<DATA>
}*/
export type ExprBuilderBooter<TABLE extends Table> = {
    [K in keyof TABLE]-?: FieldExprBuilderOf<TABLE[K], TABLE>
}

/**
 *
 * @param params
 * @param fieldName
 * @param paramValue
 *
 * return param name
 */
export function putNewParam(params: Record<string, any>, fieldName: string, paramValue: any): string {
    const namePrefix = `__`
    const nameSuffix = `__`
    const names = Object.keys(params)
    const existsCnt = names.count(it => it.startsWith(`${namePrefix}${fieldName}`))
    const newParamName = `${namePrefix}${fieldName}${nameSuffix}${existsCnt}`
    params[newParamName] = paramValue
    return ':' + newParamName
}

export function parseMysqlExpr(expr: ConditionExpr, outParams: Record<string, any>): string {
    let sql = ` ( `
    switch (expr.type) {
        case 'and':
            sql += expr.exprs
                .map(it => parseMysqlExpr(it, outParams))
                .join(' and ')
            break
        case 'or':
            sql += expr.exprs
                .map(it => parseMysqlExpr(it, outParams))
                .join(' or ')
            break
        case 'not':
            sql += `!${parseMysqlExpr(expr.expr, outParams)}`
            break
        case 'field_compare':
            sql += parseMysqlCompareExpr(expr, outParams)
            break
    }
    sql += ` ) `
    return sql
}

function parseMysqlCompareExpr(expr: ExprField, outParams: Record<string, any>): string {
    const field = expr.field
    const value = expr.value
    let paramName = ''
    const fieldInSql = `\`${field}\``
    switch (expr.op) {
        case 'in':
            // const paramNames = []
            // for (let i = 0; i < expr.value.length; i++) {
            //     const paramName = putNewParam(outParams, expr.field, expr.value[i])
            //     paramNames.push(paramName)
            // }
            // return ` ${fieldInSql} in (${paramNames.join(',')}) `
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} in (${paramName})`
        case 'eq':
            if (value == null) {
                return `${fieldInSql} is null`
            }
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} = ${paramName}`
        case 'ne':
            if (value == null) {
                return `${fieldInSql} is not null`
            }
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} != ${paramName}`
        case 'gt':
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} > ${paramName}`
        case 'gte':
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} >= ${paramName}`
        case 'lt':
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} < ${paramName}`
        case 'lte':
            paramName = putNewParam(outParams, field, value)
            return `${fieldInSql} <= ${paramName}`
    }
}

export class FieldExprBuilder implements FieldExprBuilderOf<any, any> {
    private readonly field: string

    constructor(field: string) {
        this.field = field
    }

    eq(value: any): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'eq', field: this.field, value: value })
    }

    gt(value: any): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'gt', field: this.field, value: value })
    }

    gte(value: any): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'gte', field: this.field, value: value })
    }

    in(values: any[]): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'in', field: this.field, value: values })
    }

    lt(value: any): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'lt', field: this.field, value: value })
    }

    lte(value: any): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'lte', field: this.field, value: value })
    }

    ne(value: any): ExprBuilder<any> {
        return new ExprBuilder<any>({ type: 'field_compare', op: 'ne', field: this.field, value: value })
    }
}

const _STARTER = { _symbol: Symbol() }

function getExprStarterProxy(target: Record<string, any>): any {
    return new Proxy(target, {
        get: function (target, prop) {
            const strProp = prop.toString()
            if (target === _STARTER) {
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

const Expr = getExprStarterProxy(_STARTER as any as Record<string, any>) as ExprBuilderBooter<any>

export type ConditionExprBuilderProvider<TABLE extends Table> =
    ((expr: ExprBuilderBooter<TABLE>) => ExprBuilder<TABLE> | ConditionExpr | undefined)
    | ExprBuilder<TABLE>
    | ConditionExpr

export function invokeConditionExprBuilderProvider<TABLE extends Table>(provider: ConditionExprBuilderProvider<TABLE>): ConditionExpr | undefined {
    const exprOrBuilder = typeof provider === 'function'
        ? provider(Expr as ExprBuilderBooter<TABLE>)
        : provider
    return exprOrBuilder instanceof ExprBuilder ? exprOrBuilder.build() : exprOrBuilder
}
