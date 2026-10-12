export function endpoint(fn) {
  return async function (a, b) {
    const ctx = b || a || {};
    const input = (a && (a.body || a.input || a.params)) || a || {};
    const user = ctx.user || (ctx.initData && ctx.initData.user) || (ctx.auth && ctx.auth.user) || (a && a.user) || (a && a.initData && a.initData.user);
    if (!user || !user.id) throw new Error('unauthorized');
    return fn(input, user);
  };
}
