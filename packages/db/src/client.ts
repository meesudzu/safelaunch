export interface DatabaseBindings {
  DB: D1Database;
}

export const getDatabase = (bindings: DatabaseBindings): D1Database => bindings.DB;
