import { endpoint } from '../lib/auth.js';
import { tickReminders } from '../lib/remind.js';

// Приложение зовёт этот метод раз в 5 минут: платформа не умеет запускать код по расписанию
export default endpoint(async () => ({ sent: await tickReminders() }));
