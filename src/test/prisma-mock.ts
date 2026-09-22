import { PrismaService } from '../prisma/prisma.service';

function createMockModel() {
  return {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
  };
}

export type MockPrismaService = {
  user: ReturnType<typeof createMockModel>;
  account: ReturnType<typeof createMockModel>;
  category: ReturnType<typeof createMockModel>;
  transaction: ReturnType<typeof createMockModel>;
  budget: ReturnType<typeof createMockModel>;
  uploadBatch: ReturnType<typeof createMockModel>;
  uploadRow: ReturnType<typeof createMockModel>;
  $transaction: jest.Mock;
};

// $transaction(cb)를 호출하면 같은 mock 클라이언트를 tx로 넘겨서 호출한다.
// 그래서 테스트에서는 서비스가 create/update 안에서 $transaction을 쓰든 안 쓰든
// 동일하게 prisma.account.update 등을 assert 하면 된다.
export function createPrismaMock(): MockPrismaService {
  const client = {
    user: createMockModel(),
    account: createMockModel(),
    category: createMockModel(),
    transaction: createMockModel(),
    budget: createMockModel(),
    uploadBatch: createMockModel(),
    uploadRow: createMockModel(),
  } as MockPrismaService;

  client.$transaction = jest.fn((cb: (tx: MockPrismaService) => unknown) => cb(client));

  return client;
}

export function asPrismaService(mock: MockPrismaService): PrismaService {
  return mock as unknown as PrismaService;
}
