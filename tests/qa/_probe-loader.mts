import { cookies } from 'next/headers';
console.log('cookies type:', typeof cookies);
const store = await cookies();
console.log('store get:', store.get('kernel_session'));
