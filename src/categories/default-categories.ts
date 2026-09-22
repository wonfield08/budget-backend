import { CategoryType } from '@prisma/client';

// Seeded onto every new account at signup so the upload wizard's
// keyword-based category guess (frontend guessCategoryId) has something to
// match against right away. Users can rename, delete, or add more afterward
// through the normal category endpoints — this is just a starting set, not
// a fixed list.
export interface DefaultCategory {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: '카페', type: 'EXPENSE', icon: '카', color: '#5B4BF5' },
  { name: '식비', type: 'EXPENSE', icon: '식', color: '#8B7CF8' },
  { name: '편의점', type: 'EXPENSE', icon: '편', color: '#B7AEFB' },
  { name: '교통', type: 'EXPENSE', icon: '교', color: '#F2B03D' },
  { name: '의료', type: 'EXPENSE', icon: '의', color: '#3FB6A8' },
  { name: '쇼핑', type: 'EXPENSE', icon: '쇼', color: '#2F6BFF' },
  { name: '주거·통신', type: 'EXPENSE', icon: '주', color: '#D9822B' },
  { name: '문화·여가', type: 'EXPENSE', icon: '문', color: '#0F9D76' },
  { name: '자기계발', type: 'EXPENSE', icon: '자', color: '#E5484D' },
  { name: '기타', type: 'EXPENSE', icon: '기', color: '#6B7280' },
  { name: '급여', type: 'INCOME', icon: '급', color: '#5B4BF5' },
  { name: '용돈', type: 'INCOME', icon: '용', color: '#3FB6A8' },
  { name: '부수입', type: 'INCOME', icon: '부', color: '#0F9D76' },
  { name: '기타수입', type: 'INCOME', icon: '기', color: '#6B7280' },
];
