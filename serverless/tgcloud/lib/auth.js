import { EndpointError } from 'sdk';

export function endpoint(fn) {
  return async function (input, ctx) {
    const user = ctx && ctx.initData && ctx.initData.user;
    if (!user || !user.id) throw new EndpointError('unauthorized');
    return fn(input || {}, user);
  };
}
