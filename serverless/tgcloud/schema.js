import { table, text, integer } from 'sdk/db';

export const kv = table('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(0),
});
