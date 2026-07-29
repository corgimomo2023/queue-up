import { Router } from 'express';
import { CookieName, Session } from '../../config/http-constants';
import { ActorType, AuditAction } from '../../domain/constants';
import { body, validateBody } from '../../http';
import { vendorAdminLoginSchema, type VendorAdminLoginDto } from '../../schemas';
import { secretsMatch, signVendorAdminSession } from '../../security';
import type { AppRuntime } from '../../runtime';

export function vendorAdminAuthRoutes(runtime: AppRuntime) {
  const router = Router();

  router.post('/api/super-admin/login', validateBody(vendorAdminLoginSchema), async (req, res) => {
    const { key } = body<VendorAdminLoginDto>(res);
    if (!runtime.options.superAdminKey || !secretsMatch(key, runtime.options.superAdminKey)) {
      await runtime.writeAudit(req, ActorType.Anonymous, AuditAction.VendorAdminLoginFailed);
      res.status(401).json({ error: 'Invalid Vendor Admin key' });
      return;
    }
    res.cookie(CookieName.VendorAdmin, signVendorAdminSession(runtime.options.sessionSecret), {
      httpOnly: true,
      secure: runtime.options.secureCookie !== false,
      sameSite: 'strict',
      maxAge: Session.DurationMilliseconds,
      path: '/',
    });
    await runtime.writeAudit(req, ActorType.VendorAdmin, AuditAction.VendorAdminLoginSuccess);
    res.json({ ok: true });
  });

  router.post('/api/super-admin/logout', (_req, res) => {
    res.clearCookie(CookieName.VendorAdmin, {
      httpOnly: true,
      secure: runtime.options.secureCookie !== false,
      sameSite: 'strict',
      path: '/',
    });
    res.json({ ok: true });
  });

  return router;
}
