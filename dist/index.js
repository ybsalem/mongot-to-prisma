"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mongoToPrisma = mongoToPrisma;
const LOGICAL_OPS = {
    $and: 'AND',
    $or: 'OR',
    $not: 'NOT',
};
const COMP_OPS = {
    $eq: 'equals',
    $neq: 'not',
    $gt: 'gt',
    $gte: 'gte',
    $lt: 'lt',
    $lte: 'lte',
    $in: 'in',
    $nin: 'notIn',
    $contains: 'contains',
    $startsWith: 'startsWith',
    $endsWith: 'endsWith',
};
const ATOMIC_OPS = {
    $inc: 'increment',
    $dec: 'decrement',
    $set: 'set',
    $push: 'push',
};
const DIRECT_KEYS = ['select', 'orderBy', 'by', '_count', '_sum', '_avg', '_min', '_max'];
function resolveDatePlaceholder(path) {
    const match = path.match(/^now(?:-(\d+)([smhdy])?)?$/);
    if (!match)
        return undefined;
    const now = new Date();
    if (!match[1]) {
        return now;
    }
    const amount = parseInt(match[1], 10);
    const unit = match[2] || 'd';
    switch (unit) {
        case 's':
            now.setSeconds(now.getSeconds() - amount);
            break;
        case 'm':
            now.setMinutes(now.getMinutes() - amount);
            break;
        case 'h':
            now.setHours(now.getHours() - amount);
            break;
        case 'd':
            now.setDate(now.getDate() - amount);
            break;
        case 'y':
            now.setFullYear(now.getFullYear() - amount);
            break;
        default:
            return undefined;
    }
    return now;
}
function getContextValue(path, context) {
    if (typeof path !== 'string' || !path.startsWith('$'))
        return path;
    const keys = path.slice(1).split('.').filter(Boolean);
    if (keys[0] === 'date') {
        const datePlaceholder = keys.slice(1).join('.');
        return resolveDatePlaceholder(datePlaceholder);
    }
    if (keys[0] === 'context') {
        keys.shift();
    }
    if (keys[0] === 'iterator') {
        let iteratorValue = context.iterator;
        for (const key of keys.slice(1)) {
            if (iteratorValue && typeof iteratorValue === 'object' && key in iteratorValue) {
                iteratorValue = iteratorValue[key];
            }
            else {
                return undefined;
            }
        }
        return iteratorValue;
    }
    let value = context;
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        }
        else {
            return undefined;
        }
    }
    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        try {
            return JSON.parse(value);
        }
        catch (e) {
            return value;
        }
    }
    return value;
}
function evaluateExpression(expr, context) {
    let evaluatedExpr = expr.replace(/\$([\w\.]+)/g, (match, p1) => {
        const value = getContextValue(`$${p1}`, context);
        if (value === undefined)
            return 'undefined';
        if (value === null)
            return 'null';
        if (typeof value === 'string')
            return `'${value.replace(/'/g, "\\'")}'`;
        if (value instanceof Date)
            return String(value.getTime());
        if (typeof value === 'object')
            return JSON.stringify(value);
        return String(value);
    });
    try {
        const result = new Function(`return ${evaluatedExpr}`)();
        if (typeof result === 'number' &&
            result > 1000000000000 &&
            new Date(result).getFullYear() > 2020) {
            return new Date(result);
        }
        return result;
    }
    catch (e) {
        console.error(`Error evaluating expression "${expr}" (transformed to "${evaluatedExpr}"):`, e);
        return undefined;
    }
}
function substitutePlaceholders(obj, context) {
    if (Array.isArray(obj)) {
        return obj
            .map((item) => substitutePlaceholders(item, context))
            .filter((v) => v !== undefined);
    }
    if (obj && typeof obj === 'object') {
        if (obj['$expr'] && typeof obj['$expr'] === 'string') {
            const potentialDate = getContextValue(obj['$expr'], context);
            if (potentialDate instanceof Date) {
                return potentialDate;
            }
            return evaluateExpression(obj['$expr'], context);
        }
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const substitutedValue = substitutePlaceholders(value, context);
            if (substitutedValue !== undefined) {
                result[key] = substitutedValue;
            }
        }
        return result;
    }
    if (typeof obj === 'string' && obj.startsWith('$')) {
        return getContextValue(obj, context);
    }
    return obj;
}
function parseValue(value) {
    if (value === 'true')
        return true;
    if (value === 'false')
        return false;
    if (value === 'null')
        return null;
    if (value === 'undefined')
        return undefined;
    if (!isNaN(Number(value)) && value.trim() !== '') {
        return Number(value);
    }
    return value;
}
function preprocessWhereClause(clause) {
    if (!clause || typeof clause !== 'object' || Array.isArray(clause)) {
        return clause;
    }
    const result = {};
    for (const [key, value] of Object.entries(clause)) {
        if (LOGICAL_OPS[key] && Array.isArray(value)) {
            result[key] = value.map(preprocessWhereClause);
        }
        else if (typeof value === 'string' && value.includes(':')) {
            const [op, ...rest] = value.split(':');
            const val = rest.join(':');
            if (COMP_OPS[op]) {
                result[key] = { [COMP_OPS[op]]: parseValue(val) };
            }
            else {
                result[key] = value;
            }
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
function mapWhere(whereClause) {
    if (!whereClause || typeof whereClause !== 'object')
        return whereClause;
    const result = {};
    for (const [key, value] of Object.entries(whereClause)) {
        if (LOGICAL_OPS[key]) {
            result[LOGICAL_OPS[key]] = Array.isArray(value) ? value.map(mapWhere) : mapWhere(value);
        }
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            const subQuery = {};
            for (const [op, v] of Object.entries(value)) {
                const mappedOp = COMP_OPS[op] || op;
                const mappedV = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
                    ? mapWhere({ _: v })._
                    : v;
                subQuery[mappedOp] = mappedV;
                if (typeof mappedV === 'string' &&
                    ['contains', 'startsWith', 'endsWith'].includes(mappedOp)) {
                    subQuery.mode = 'insensitive';
                }
            }
            result[key] = subQuery;
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
function mapData(dataClause) {
    if (!dataClause || typeof dataClause !== 'object')
        return dataClause;
    if (Array.isArray(dataClause))
        return dataClause.map(mapData);
    const result = {};
    for (const [key, value] of Object.entries(dataClause)) {
        if (value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            !(value instanceof Date)) {
            const subQuery = {};
            for (const [op, v] of Object.entries(value)) {
                if (ATOMIC_OPS[op]) {
                    subQuery[ATOMIC_OPS[op]] = v;
                }
                else {
                    subQuery[op] = v;
                }
            }
            result[key] = subQuery;
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
function mapRelationClause(clause, currentDepth = 0) {
    const MAX_DEPTH = 2;
    if (!clause)
        return undefined;
    if (typeof clause === 'string') {
        const trimmed = clause.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                clause = JSON.parse(trimmed);
            }
            catch (e) {
                const err = new Error("Malformed JSON in query relation include");
                err.name = "QueryParseError";
                throw err;
            }
        }
        else {
            const parts = clause.split(',').map(s => s.trim()).filter(Boolean);
            clause = parts;
        }
    }
    if (Array.isArray(clause)) {
        const result = {};
        for (const item of clause) {
            if (typeof item === 'string') {
                result[item] = true;
            }
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }
    if (typeof clause !== 'object')
        return undefined;
    const result = {};
    for (const [key, value] of Object.entries(clause)) {
        if (value === true || value === 'true') {
            result[key] = true;
        }
        else if (value && typeof value === 'object') {
            const valObj = value;
            if (currentDepth >= MAX_DEPTH - 1) {
                const { include: _inc, select: _sel, ...rest } = valObj;
                result[key] = Object.keys(rest).length > 0 ? rest : true;
            }
            else {
                const newObj = { ...valObj };
                if (valObj.include) {
                    const mappedNestedInclude = mapRelationClause(valObj.include, currentDepth + 1);
                    if (mappedNestedInclude) {
                        newObj.include = mappedNestedInclude;
                    }
                    else {
                        delete newObj.include;
                    }
                }
                if (valObj.select) {
                    const mappedNestedSelect = mapRelationClause(valObj.select, currentDepth + 1);
                    if (mappedNestedSelect) {
                        newObj.select = mappedNestedSelect;
                    }
                    else {
                        delete newObj.select;
                    }
                }
                if (Object.keys(newObj).length === 0) {
                    result[key] = true;
                }
                else {
                    result[key] = newObj;
                }
            }
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
function sanitizeObject(obj) {
    if (obj instanceof Date)
        return obj;
    if (Array.isArray(obj)) {
        const sanitizedArray = obj.map(sanitizeObject).filter((item) => item !== undefined);
        return sanitizedArray.length > 0 ? sanitizedArray : undefined;
    }
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key of Object.keys(obj)) {
            if (obj[key] === undefined)
                continue;
            const sanitizedValue = sanitizeObject(obj[key]);
            if (sanitizedValue !== undefined) {
                newObj[key] = sanitizedValue;
            }
        }
        return Object.keys(newObj).length > 0 ? newObj : undefined;
    }
    return obj;
}
function mongoToPrisma(structuredQuery, context = {}) {
    let queryToProcess = structuredQuery;
    if (structuredQuery && structuredQuery.where) {
        queryToProcess = {
            ...structuredQuery,
            where: preprocessWhereClause(structuredQuery.where),
        };
    }
    const substitutedQuery = substitutePlaceholders(queryToProcess, context);
    if (substitutedQuery === null || substitutedQuery === undefined) {
        return null;
    }
    if (typeof substitutedQuery !== 'object' || Array.isArray(substitutedQuery)) {
        return substitutedQuery;
    }
    const hasPrismaKeys = Object.keys(substitutedQuery).some(key => ['where', 'data', 'create', 'update', 'include', 'select', 'orderBy', 'skip', 'take'].includes(key));
    if (!substitutedQuery.entity && !substitutedQuery.type && !hasPrismaKeys) {
        return sanitizeObject(substitutedQuery);
    }
    const prismaQuery = {};
    for (const [key, value] of Object.entries(substitutedQuery)) {
        if (key === 'type' || key === 'entity')
            continue;
        if (key === 'where') {
            prismaQuery.where = mapWhere(value);
        }
        else if (key === 'data') {
            prismaQuery.data = mapData(value);
        }
        else if (key === 'create') {
            prismaQuery.create = mapData(value);
        }
        else if (key === 'update') {
            prismaQuery.update = mapData(value);
        }
        else if (key === 'include') {
            const mappedInclude = mapRelationClause(value);
            if (mappedInclude) {
                prismaQuery.include = mappedInclude;
            }
        }
        else if (key === 'select') {
            const mappedSelect = mapRelationClause(value);
            if (mappedSelect) {
                prismaQuery.select = mappedSelect;
            }
        }
        else if (key === 'skip') {
            const num = Number(value);
            prismaQuery.skip = !isNaN(num) ? num : 0;
        }
        else if (key === 'take') {
            const num = Number(value);
            prismaQuery.take = !isNaN(num) ? num : 10;
        }
        else if (key === 'orderBy') {
            if (typeof value === 'string') {
                const [field, order] = value.split(':');
                if (field && order) {
                    prismaQuery.orderBy = { [field]: order.toLowerCase() };
                }
            }
            else if (Array.isArray(value)) {
                prismaQuery.orderBy = value;
            }
            else if (typeof value === 'object' && value !== null) {
                const newOrderBy = {};
                for (const field in value) {
                    const order = String(value[field]).toLowerCase();
                    newOrderBy[field] = ['asc', 'desc'].includes(order) ? order : 'desc';
                }
                prismaQuery.orderBy = newOrderBy;
            }
        }
        else if (DIRECT_KEYS.includes(key) && key !== 'select') {
            prismaQuery[key] = value;
        }
    }
    if (structuredQuery.type === 'findUnique' && !prismaQuery.where && prismaQuery.include) {
        delete prismaQuery.include;
    }
    const finalQuery = sanitizeObject(prismaQuery);
    return finalQuery || {};
}
//# sourceMappingURL=index.js.map