/* ==========================================================================
   ACPM PMOS — Subscription Manager
   Centralized Firebase Realtime Database listener management for PMOS Office.

   Features:
   - Unique subscription keys with duplicate prevention
   - Group-based subscription management
   - Active-view-only subscriptions
   - Active-project-only subscriptions
   - Cleanup on filter/project/view change
   - Cleanup on close/logout
   - Error handling per subscription
   - Development diagnostics (no Firebase paths shown to normal users)
   ========================================================================== */

(function () {
  'use strict';

  const PMOSSubscriptionManager = {
    _subscriptions: new Map(),
    _groups: new Map(),
    _diagnostics: false,

    /* ---- Diagnostics (enable for dev) ---- */
    enableDiagnostics(enabled) {
      this._diagnostics = enabled !== false;
    },

    /* ---- Subscribe ---- */
    subscribe({ key, group, module, projectId, path, queryFactory, callback, errorCallback }) {
      if (!key) {
        if (this._diagnostics) console.warn('PMOS Subscription Manager: key is required.');
        return null;
      }
      // Prevent duplicate subscriptions
      if (this._subscriptions.has(key)) {
        if (this._diagnostics) console.log('PMOS Subscription Manager: Skipping duplicate subscription:', key);
        return this._subscriptions.get(key);
      }

      if (!callback || typeof callback !== 'function') {
        if (this._diagnostics) console.warn('PMOS Subscription Manager: callback function is required.');
        return null;
      }

      try {
        const ref = queryFactory ? queryFactory() : (path ? firebase.database().ref(path) : null);
        if (!ref) {
          if (this._diagnostics) console.warn('PMOS Subscription Manager: Could not create Firebase ref for key:', key);
          return null;
        }

        const unsubscribe = () => {
          ref.off('value', callback);
        };

        const errorHandler = errorCallback || function (err) {
          const permissionDenied = String(err?.code || err?.message || '').toLowerCase().includes('permission');
          if (!permissionDenied && this._diagnostics) {
            console.warn('PMOS Subscription Manager: Listener error [' + key + ']:', err?.code || err?.message || err);
          }
        }.bind(this);

        ref.on('value', callback, errorHandler);

        const subscription = { key, group: group || 'default', module, projectId, ref, callback, errorHandler, unsubscribe, createdAt: Date.now() };
        this._subscriptions.set(key, subscription);

        // Track by group
        if (group) {
          if (!this._groups.has(group)) this._groups.set(group, new Set());
          this._groups.get(group).add(key);
        }

        if (this._diagnostics) {
          console.log('PMOS Subscription Manager: Subscribed [' + key + '] (active: ' + this._subscriptions.size + ')');
        }

        return subscription;
      } catch (e) {
        if (this._diagnostics) console.error('PMOS Subscription Manager: Failed to subscribe [' + key + ']:', e);
        return null;
      }
    },

    /* ---- Unsubscribe single ---- */
    unsubscribe(key) {
      const sub = this._subscriptions.get(key);
      if (!sub) {
        if (this._diagnostics) console.log(`PMOS Subscription Manager: No subscription found for key: ${key}`);
        return false;
      }
      try {
        sub.unsubscribe();
        this._subscriptions.delete(key);
        // Remove from group
        if (sub.group && this._groups.has(sub.group)) {
          this._groups.get(sub.group).delete(key);
          if (this._groups.get(sub.group).size === 0) this._groups.delete(sub.group);
        }
        if (this._diagnostics) {
          console.log(`PMOS Subscription Manager: Unsubscribed [${key}] (active: ${this._subscriptions.size})`);
        }
        return true;
      } catch (e) {
        console.warn(`PMOS Subscription Manager: Error unsubscribing [${key}]:`, e);
        return false;
      }
    },

    /* ---- Unsubscribe group ---- */
    unsubscribeGroup(group) {
      if (!group || !this._groups.has(group)) return 0;
      const keys = Array.from(this._groups.get(group));
      let count = 0;
      keys.forEach(key => {
        if (this.unsubscribe(key)) count++;
      });
      if (this._diagnostics) {
        console.log(`PMOS Subscription Manager: Unsubscribed group [${group}] - ${count} subscription(s)`);
      }
      return count;
    },

    /* ---- Unsubscribe all ---- */
    unsubscribeAll() {
      const count = this._subscriptions.size;
      const keys = Array.from(this._subscriptions.keys());
      keys.forEach(key => this.unsubscribe(key));
      this._groups.clear();
      if (this._diagnostics) {
        console.log(`PMOS Subscription Manager: Unsubscribed all - ${count} subscription(s)`);
      }
      return count;
    },

    /* ---- Get active count ---- */
    getActiveCount() {
      return this._subscriptions.size;
    },

    /* ---- Get active subscriptions ---- */
    getActiveSubscriptions() {
      return Array.from(this._subscriptions.values()).map(s => ({
        key: s.key,
        group: s.group,
        module: s.module,
        projectId: s.projectId,
        createdAt: s.createdAt
      }));
    },

    /* ---- Get subscriptions by group ---- */
    getSubscriptionsByGroup(group) {
      if (!this._groups.has(group)) return [];
      return Array.from(this._groups.get(group))
        .map(key => this._subscriptions.get(key))
        .filter(Boolean)
        .map(s => ({ key: s.key, group: s.group, module: s.module, projectId: s.projectId }));
    },

    /* ---- Get subscriptions by module ---- */
    getSubscriptionsByModule(module) {
      return Array.from(this._subscriptions.values())
        .filter(s => s.module === module)
        .map(s => ({ key: s.key, group: s.group, module: s.module, projectId: s.projectId }));
    }
  };

  window.PMOSSubscriptionManager = PMOSSubscriptionManager;

})();
