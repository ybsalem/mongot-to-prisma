import { mongoToPrisma } from './index';

describe('mongoToPrisma (Feedback Service)', () => {
    it('should return null when $expr evaluates to falsy (False Truthy Fix)', () => {
        const context = { existingLike: null };
        const query = { $expr: '$existingLike' };
        const result = mongoToPrisma(query, context);
        expect(result).toBeNull();
    });

    it('should return object when $expr evaluates to object', () => {
        const context = { existingLike: { id: 1 } };
        const query = { $expr: '$existingLike' };
        const result = mongoToPrisma(query, context);
        // With the heuristic for non-Prisma objects, it returns the object directly.
        // It remains Truthy, which is the desired behavior for existence check.
        expect(result).toEqual({ id: 1 });
    });

    it('should correctly preprocess short syntax types (Type Coercion Fix)', () => {
        const query = {
            where: {
                age: '$gt:18',
                isActive: '$eq:true',
                score: '$lt:10.5',
                name: '$eq:John',
            },
        };
        const result = mongoToPrisma(query);
        expect(result.where).toEqual({
            age: { gt: 18 },
            isActive: { equals: true },
            score: { lt: 10.5 },
            name: { equals: 'John' },
        });
    });

    it('should handle complex nested logical operators', () => {
        const query = {
            where: {
                $or: [
                    { status: '$eq:active' },
                    { $and: [{ age: '$gte:18' }, { role: '$eq:admin' }] }
                ]
            }
        };
        const result = mongoToPrisma(query);

        if (!result.where) {
            throw new Error('result.where is undefined');
        }

        expect(result.where.OR).toHaveLength(2);
        expect(result.where.OR[0]).toEqual({ status: { equals: 'active' } });

        const andClause = result.where.OR[1].AND;
        expect(andClause[0]).toEqual({ age: { gte: 18 } });
        expect(andClause[1]).toEqual({ role: { equals: 'admin' } });
    });

    it('should correctly parse simple string include', () => {
        const query = { include: 'author,comments' };
        const result = mongoToPrisma(query);
        expect(result.include).toEqual({ author: true, comments: true });
    });

    it('should correctly parse simple object include', () => {
        const query = { include: { author: 'true', comments: true } };
        const result = mongoToPrisma(query);
        expect(result.include).toEqual({ author: true, comments: true });
    });

    it('should correctly parse nested include up to MAX_DEPTH', () => {
        const query = { include: { comments: { include: { user: true } } } };
        const result = mongoToPrisma(query);
        expect(result.include).toEqual({ comments: { include: { user: true } } });
    });

    it('should truncate includes exceeding MAX_DEPTH (DoS mitigation)', () => {
        const query = { 
            include: { 
                comments: { 
                    include: { 
                        user: { 
                            include: { 
                                profile: true 
                            } 
                        } 
                    } 
                } 
            } 
        };
        const result = mongoToPrisma(query);
        expect(result.include).toEqual({ comments: { include: { user: true } } });
    });

    it('should correctly parse select statements', () => {
        const query = { select: 'id,name' };
        const result = mongoToPrisma(query);
        expect(result.select).toEqual({ id: true, name: true });
    });
});
