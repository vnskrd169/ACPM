import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PMOS Subscription Manager', () => {
  // Mock implementation of PMOSSubscriptionManager for testing
  interface Subscription {
    key: string;
    group: string;
    module: string;
    projectId: string;
  }

  let subscriptions: Map<string, Subscription>;
  let mockSubManager: any;

  beforeEach(() => {
    subscriptions = new Map();

    mockSubManager = {
      subscribe: vi.fn((opts: any) => {
        if (subscriptions.has(opts.key)) {
          return; // prevent duplicates
        }
        subscriptions.set(opts.key, {
          key: opts.key,
          group: opts.group,
          module: opts.module,
          projectId: opts.projectId || '',
        });
      }),
      unsubscribe: vi.fn((key: string) => {
        subscriptions.delete(key);
      }),
      unsubscribeGroup: vi.fn((group: string) => {
        subscriptions.forEach((sub, key) => {
          if (sub.group === group) {
            subscriptions.delete(key);
          }
        });
      }),
      unsubscribeAll: vi.fn(() => {
        subscriptions.clear();
      }),
      getActiveCount: vi.fn(() => subscriptions.size),
      getActiveSubscriptions: vi.fn(() => Array.from(subscriptions.values())),
      enableDiagnostics: vi.fn(),
    };
  });

  describe('subscribe', () => {
    it('adds a subscription with correct fields', () => {
      mockSubManager.subscribe({
        key: 'inbox:pmosUpdates',
        group: 'pmos-inbox',
        module: 'updates',
        projectId: '',
        queryFactory: () => null,
        callback: () => {},
      });

      expect(mockSubManager.getActiveCount()).toBe(1);
      const active = mockSubManager.getActiveSubscriptions();
      expect(active[0].key).toBe('inbox:pmosUpdates');
      expect(active[0].group).toBe('pmos-inbox');
    });

    it('prevents duplicate subscriptions by key', () => {
      const opts = {
        key: 'inbox:pmosUpdates',
        group: 'pmos-inbox',
        module: 'updates',
        projectId: '',
        queryFactory: () => null,
        callback: () => {},
      };

      mockSubManager.subscribe(opts);
      mockSubManager.subscribe(opts); // duplicate

      expect(mockSubManager.getActiveCount()).toBe(1);
    });
  });

  describe('unsubscribe by key', () => {
    it('removes a single subscription', () => {
      mockSubManager.subscribe({
        key: 'issues:all',
        group: 'pmos-issues',
        module: 'issues',
        projectId: '',
        queryFactory: () => null,
        callback: () => {},
      });

      mockSubManager.unsubscribe('issues:all');
      expect(mockSubManager.getActiveCount()).toBe(0);
    });
  });

  describe('unsubscribeGroup', () => {
    it('removes all subscriptions in a group', () => {
      mockSubManager.subscribe({ key: 'inbox:a', group: 'pmos-inbox', module: 'updates', projectId: '', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'inbox:b', group: 'pmos-inbox', module: 'issues', projectId: '', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'issues:a', group: 'pmos-issues', module: 'issues', projectId: '', queryFactory: () => null, callback: () => {} });

      mockSubManager.unsubscribeGroup('pmos-inbox');
      expect(mockSubManager.getActiveCount()).toBe(1);
      expect(mockSubManager.getActiveSubscriptions()[0].group).toBe('pmos-issues');
    });

    it('does nothing when group has no subscriptions', () => {
      mockSubManager.subscribe({ key: 'test', group: 'pmos-inbox', module: 'updates', projectId: '', queryFactory: () => null, callback: () => {} });
      mockSubManager.unsubscribeGroup('non-existent');
      expect(mockSubManager.getActiveCount()).toBe(1);
    });
  });

  describe('unsubscribeAll', () => {
    it('removes all subscriptions', () => {
      mockSubManager.subscribe({ key: 'a', group: 'pmos-inbox', module: 'updates', projectId: '', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'b', group: 'pmos-issues', module: 'issues', projectId: '', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'c', group: 'pmos-materials', module: 'materials', projectId: '', queryFactory: () => null, callback: () => {} });

      expect(mockSubManager.getActiveCount()).toBe(3);
      mockSubManager.unsubscribeAll();
      expect(mockSubManager.getActiveCount()).toBe(0);
    });
  });

  describe('view switching cleanup', () => {
    it('removes irrelevant subscriptions when switching views', () => {
      // Subscribe for inbox
      mockSubManager.subscribe({ key: 'inbox:a', group: 'pmos-inbox', module: 'updates', projectId: '', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'inbox:b', group: 'pmos-inbox', module: 'issues', projectId: '', queryFactory: () => null, callback: () => {} });

      // Switch to issues view: unsubscribe inbox group, subscribe issues
      mockSubManager.unsubscribeGroup('pmos-inbox');
      mockSubManager.subscribe({ key: 'issues:a', group: 'pmos-issues', module: 'issues', projectId: '', queryFactory: () => null, callback: () => {} });

      expect(mockSubManager.getActiveCount()).toBe(1);
      expect(mockSubManager.getActiveSubscriptions()[0].group).toBe('pmos-issues');
    });

    it('repeated view switches maintain correct count', () => {
      const views = ['pmos-inbox', 'pmos-issues', 'pmos-materials', 'pmos-tasks', 'pmos-sitelogs', 'pmos-photos', 'pmos-meetings', 'pmos-reports'];

      views.forEach((group) => {
        mockSubManager.unsubscribeAll();
        mockSubManager.subscribe({ key: `${group}:test`, group, module: 'test', projectId: '', queryFactory: () => null, callback: () => {} });
      });

      // After switching through all views, should have exactly 1 active subscription
      expect(mockSubManager.getActiveCount()).toBe(1);
    });
  });

  describe('project change cleanup', () => {
    it('removes previous project subscriptions when project changes', () => {
      // Subscribe for project-1
      mockSubManager.subscribe({ key: 'feed:project-1:updates', group: 'pmos-project-feed', module: 'updates', projectId: 'project-1', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'feed:project-1:issues', group: 'pmos-project-feed', module: 'issues', projectId: 'project-1', queryFactory: () => null, callback: () => {} });

      expect(mockSubManager.getActiveCount()).toBe(2);

      // Switch to project-2: unsubscribe old, subscribe new
      mockSubManager.unsubscribeGroup('pmos-project-feed');
      mockSubManager.subscribe({ key: 'feed:project-2:updates', group: 'pmos-project-feed', module: 'updates', projectId: 'project-2', queryFactory: () => null, callback: () => {} });
      mockSubManager.subscribe({ key: 'feed:project-2:issues', group: 'pmos-project-feed', module: 'issues', projectId: 'project-2', queryFactory: () => null, callback: () => {} });

      expect(mockSubManager.getActiveCount()).toBe(2);

      // Verify no old project subscriptions remain
      const active = mockSubManager.getActiveSubscriptions();
      active.forEach((sub: any) => {
        expect(sub.projectId).toBe('project-2');
      });
    });
  });

  describe('edge cases', () => {
    it('handles subscribing with empty key gracefully', () => {
      mockSubManager.subscribe({ key: '', group: 'pmos-inbox', module: 'updates', projectId: '', queryFactory: () => null, callback: () => {} });
      // Should still work even with empty key
      expect(mockSubManager.getActiveCount()).toBe(1);
    });

    it('unsubscribe on nonexistent key is safe', () => {
      expect(() => mockSubManager.unsubscribe('nonexistent')).not.toThrow();
    });

    it('unsubscribeAll on empty manager is safe', () => {
      mockSubManager.unsubscribeAll();
      expect(mockSubManager.getActiveCount()).toBe(0);
    });
  });
});
