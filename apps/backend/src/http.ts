import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';
import type { Actor } from './types';

type Validated = { body?: unknown; params?: unknown; query?: unknown; actor?: Actor };

function validate(location: 'body' | 'params' | 'query', schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    try {
      (res.locals as Validated)[location] = schema.parse(req[location]);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const validateBody = (schema: z.ZodType): RequestHandler => validate('body', schema);
export const validateParams = (schema: z.ZodType): RequestHandler => validate('params', schema);
export const validateQuery = (schema: z.ZodType): RequestHandler => validate('query', schema);

export function body<T>(res: Response): T {
  return (res.locals as Validated).body as T;
}
export function params<T>(res: Response): T {
  return (res.locals as Validated).params as T;
}
export function query<T>(res: Response): T {
  return (res.locals as Validated).query as T;
}
export function actor<T extends Actor>(res: Response): T {
  return (res.locals as Validated).actor as T;
}
export function setActor(res: Response, value: Actor): void {
  (res.locals as Validated).actor = value;
}
