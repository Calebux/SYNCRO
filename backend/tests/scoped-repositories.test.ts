import { SubscriptionRepository } from '../src/repositories/aggregate.repositories';

function mockClient() {
  const eq = jest.fn().mockReturnThis();
  const select = jest.fn(() => ({ eq }));
  const insert = jest.fn().mockReturnValue({ select: jest.fn() });
  const update = jest.fn(() => ({ eq }));
  const remove = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select, insert, update, delete: remove }));
  return { client: { from } as never, from, eq, insert, update, remove };
}

describe('scoped aggregate repositories', () => {
  it('cannot be constructed without a user scope', () => {
    const { client } = mockClient();
    expect(() => new SubscriptionRepository('', client)).toThrow('A user scope is required');
  });

  it('applies the user scope to reads', () => {
    const { client, eq } = mockClient();
    new SubscriptionRepository('user-a', client).list();
    expect(eq).toHaveBeenCalledWith('user_id', 'user-a');
  });

  it('overrides a forged user id on inserts', () => {
    const { client, insert } = mockClient();
    new SubscriptionRepository('user-a', client).create({ user_id: 'user-b', name: 'Plan' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-a' }));
  });

  it('scopes mutations before adding aggregate predicates', () => {
    const { client, eq } = mockClient();
    const repository = new SubscriptionRepository('user-a', client);
    repository.updateById('sub-b', { name: 'Changed', user_id: 'user-b' });
    expect(eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-a');
    expect(eq).toHaveBeenNthCalledWith(2, 'id', 'sub-b');
  });
});
