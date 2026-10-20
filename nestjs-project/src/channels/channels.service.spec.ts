import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import {
  DataSource,
  QueryFailedError,
  type DeepPartial,
  type FindOneOptions,
} from 'typeorm';
import { ChannelsService } from './channels.service';
import { Channel } from './entities/channel.entity';

interface ChannelManagerMock {
  findOne: jest.Mock<
    (
      entity: typeof Channel,
      options: FindOneOptions<Channel>,
    ) => Promise<Channel | null>
  >;
  create: jest.Mock<
    (entity: typeof Channel, input: DeepPartial<Channel>) => Channel
  >;
  save: jest.Mock<(channel: Channel) => Promise<Channel>>;
}

function makeManager(
  overrides: Partial<ChannelManagerMock> = {},
): ChannelManagerMock {
  return {
    findOne: jest.fn<ChannelManagerMock['findOne']>().mockResolvedValue(null),
    create: jest.fn<ChannelManagerMock['create']>(),
    save: jest.fn<ChannelManagerMock['save']>(),
    ...overrides,
  };
}

function makeChannel(nickname: string): Channel {
  const c = new Channel();
  c.id = 'uuid';
  c.nickname = nickname;
  c.name = nickname;
  c.user_id = 'user-id';
  c.description = null;
  c.created_at = new Date();
  c.updated_at = new Date();
  return c;
}

function makeUniqueError(): QueryFailedError {
  const driverError = Object.assign(new Error(), {
    code: '23505',
    detail: 'Key (nickname)=(abc) already exists.',
  });
  return new QueryFailedError('INSERT', [], driverError);
}

async function makeService(
  manager: ChannelManagerMock,
): Promise<ChannelsService> {
  const transaction = jest
    .fn<
      (
        callback: (manager: ChannelManagerMock) => Promise<Channel>,
      ) => Promise<Channel>
    >()
    .mockImplementation((callback) => callback(manager));
  const module = await Test.createTestingModule({
    providers: [
      ChannelsService,
      { provide: DataSource, useValue: { transaction } },
    ],
  }).compile();
  return module.get(ChannelsService);
}

describe('ChannelsService', () => {
  describe('createChannel', () => {
    it('derives nickname from email prefix and saves when no collision', async () => {
      const channel = makeChannel('test');
      const manager = makeManager({
        findOne: jest
          .fn<ChannelManagerMock['findOne']>()
          .mockResolvedValue(null),
        create: jest
          .fn<ChannelManagerMock['create']>()
          .mockReturnValue(channel),
        save: jest.fn<ChannelManagerMock['save']>().mockResolvedValue(channel),
      });
      const service = await makeService(manager);

      const result = await service.createChannel('user-id', 'test@example.com');

      expect(manager.findOne).toHaveBeenCalledWith(Channel, {
        where: { nickname: 'test' },
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.nickname).toBe('test');
    });

    it('retries with suffix when pre-check finds existing nickname', async () => {
      const colliding = makeChannel('john');
      const resolved = makeChannel('john_abc');
      const manager = makeManager({
        findOne: jest
          .fn<ChannelManagerMock['findOne']>()
          .mockResolvedValueOnce(colliding)
          .mockResolvedValueOnce(null),
        create: jest
          .fn<ChannelManagerMock['create']>()
          .mockReturnValue(resolved),
        save: jest.fn<ChannelManagerMock['save']>().mockResolvedValue(resolved),
      });
      const service = await makeService(manager);

      const result = await service.createChannel('user-id', 'john@example.com');

      expect(manager.findOne).toHaveBeenCalledTimes(2);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(result.nickname).toMatch(/^john_[a-z0-9]{3}$/);
    });

    it('retries with suffix on concurrent unique constraint violation', async () => {
      const resolved = makeChannel('alice_abc');
      const manager = makeManager({
        findOne: jest
          .fn<ChannelManagerMock['findOne']>()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest
          .fn<ChannelManagerMock['create']>()
          .mockReturnValue(resolved),
        save: jest
          .fn<ChannelManagerMock['save']>()
          .mockRejectedValueOnce(makeUniqueError())
          .mockResolvedValueOnce(resolved),
      });
      const service = await makeService(manager);

      const result = await service.createChannel(
        'user-id',
        'alice@example.com',
      );

      expect(manager.save).toHaveBeenCalledTimes(2);
      expect(result.nickname).toMatch(/^alice/);
    });

    it('throws after exhausting max retries', async () => {
      const existing = makeChannel('bob');
      const manager = makeManager({
        findOne: jest
          .fn<ChannelManagerMock['findOne']>()
          .mockResolvedValue(existing),
        create: jest.fn<ChannelManagerMock['create']>(),
        save: jest.fn<ChannelManagerMock['save']>(),
      });
      const service = await makeService(manager);

      await expect(
        service.createChannel('user-id', 'bob@example.com'),
      ).rejects.toThrow(
        'Nickname conflict could not be resolved after max retries',
      );
    });

    it('re-throws non-unique-constraint errors immediately', async () => {
      const unexpectedError = new Error('Connection lost');
      const channel = makeChannel('carol');
      const manager = makeManager({
        findOne: jest
          .fn<ChannelManagerMock['findOne']>()
          .mockResolvedValue(null),
        create: jest
          .fn<ChannelManagerMock['create']>()
          .mockReturnValue(channel),
        save: jest
          .fn<ChannelManagerMock['save']>()
          .mockRejectedValue(unexpectedError),
      });
      const service = await makeService(manager);

      await expect(
        service.createChannel('user-id', 'carol@example.com'),
      ).rejects.toThrow('Connection lost');
      expect(manager.save).toHaveBeenCalledTimes(1);
    });
  });
});
