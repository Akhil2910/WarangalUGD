/** What the signed-in person may do (from their role's row in the permission grid). Set at sign-in. */
let PERMS = new Set<string>();
export const setPerms = (p: readonly string[] | undefined) => { PERMS = new Set(p ?? []); };
export const allowed = (action: string) => PERMS.has(action);
export const allowedAny = (...actions: string[]) => actions.some((a) => PERMS.has(a));
