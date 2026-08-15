/* ==========================================================================
   ACPM PMOS — Pagination Helper
   Reusable bounded Firebase queries with Load More for Office Hub views.

   Features:
   - Bounded initial queries with configurable page sizes
   - Firebase cursor-based pagination (newest-first)
   - Stable key tie-breaker for equal timestamps
   - No duplicate records across pages
   - Loading, disabled, end-of-results, error states
   - Reset on project/filter changes
   - Fallback-path deduplication across pages
   ========================================================================== */

(function () {
  'use strict';

  function PMOSPagination(config) {
    this.config = {
      pageSize: config.pageSize || 30,
      collection: config.collection || '',
      projectId: config.projectId || '',
      orderBy: config.orderBy || 'createdAt',
      filterField: config.filterField || '',
      filterValue: config.filterValue || '',
      fallbackPath: config.fallbackPath || '',
      onPage: config.onPage || function () {},
      onError: config.onError || function () {},
      onStateChange: config.onStateChange || function () {}
    };

    this.state = {
      pages: [],
      cursors: [],
      lastKey: null,
      lastTimestamp: null,
      hasMore: true,
      loading: false,
      error: null,
      page: 0,
      totalFetched: 0
    };
  }

  PMOSPagination.prototype.reset = function (newConfig) {
    if (newConfig) {
      Object.assign(this.config, newConfig);
    }
    this.state = {
      pages: [],
      cursors: [],
      lastKey: null,
      lastTimestamp: null,
      hasMore: true,
      loading: false,
      error: null,
      page: 0,
      totalFetched: 0
    };
  };

  PMOSPagination.prototype.loadFirstPage = function () {
    this.reset();
    return this._fetchPage(true);
  };

  PMOSPagination.prototype.loadNextPage = function () {
    if (!this.state.hasMore || this.state.loading) return Promise.resolve(null);
    return this._fetchPage(false);
  };

  PMOSPagination.prototype._fetchPage = function (isFirst) {
    var self = this;
    self.state.loading = true;
    self.state.error = null;
    self.config.onStateChange({ loading: true, page: self.state.page, hasMore: self.state.hasMore });

    var ref;
    if (self.config.fallbackPath) {
      ref = firebase.database().ref(self.config.fallbackPath);
    } else if (self.config.projectId) {
      ref = firebase.database().ref('projects/' + self.config.projectId + '/' + self.config.collection);
    } else {
      ref = firebase.database().ref(self.config.collection);
    }

    // Build query
    var query = ref.orderByChild(self.config.orderBy);

    if (isFirst) {
      query = query.limitToLast(self.config.pageSize + 1);
    } else {
      // Cursor: end before the last known record
      if (self.state.lastTimestamp !== null) {
        query = query.endAt(self.state.lastTimestamp, self.state.lastKey || '');
        // Use a small offset to avoid including the boundary record
        // Firebase RTDB doesn't support offset, so we over-fetch and dedupe
        query = query.limitToLast(self.config.pageSize + 2);
      } else {
        query = query.limitToLast(self.config.pageSize + 1);
      }
    }

    return new Promise(function (resolve) {
      query.once('value')
        .then(function (snap) {
          var items = [];
          snap.forEach(function (child) {
            var val = child.val() || {};
            items.push({
              id: val.id || child.key,
              _key: child.key,
              _timestamp: val[self.config.orderBy] || 0,
              _collection: self.config.collection,
              ...val
            });
          });

          // Reverse to newest-first (Firebase returns oldest-first with limitToLast)
          items.reverse();

          // Apply client-side filter if set
          if (self.config.filterField && self.config.filterValue) {
            items = items.filter(function (item) {
              return String(item[self.config.filterField] || '') === self.config.filterValue;
            });
          }

          // Deduplicate against existing records using _key
          var existingKeys = {};
          self.state.pages.forEach(function (page) {
            (page || []).forEach(function (item) {
              existingKeys[item._key] = true;
            });
          });

          var newItems = [];
          items.forEach(function (item) {
            if (!existingKeys[item._key]) {
              newItems.push(item);
              existingKeys[item._key] = true;
            }
          });

          // Check if we got fewer items than page size (end of results)
          if (newItems.length === 0) {
            self.state.hasMore = false;
          } else if (newItems.length <= self.config.pageSize && isFirst) {
            self.state.hasMore = items.length > self.config.pageSize;
            if (items.length > self.config.pageSize) {
              // Remove the extra item used as boundary
              newItems = newItems.slice(0, self.config.pageSize);
            }
          } else if (newItems.length <= self.config.pageSize && !isFirst) {
            self.state.hasMore = false;
          }

          // Store cursor for next page
          if (newItems.length > 0) {
            var last = newItems[newItems.length - 1];
            self.state.lastTimestamp = last._timestamp;
            self.state.lastKey = last._key;
            self.state.cursors.push({ timestamp: last._timestamp, key: last._key });
          } else {
            self.state.hasMore = false;
          }

          self.state.pages.push(newItems);
          self.state.page++;
          self.state.totalFetched += newItems.length;
          self.state.loading = false;

          self.config.onStateChange({
            loading: false,
            page: self.state.page,
            hasMore: self.state.hasMore,
            totalFetched: self.state.totalFetched,
            error: null
          });

          self.config.onPage(newItems, self.state.page, self.state.hasMore);
          resolve(newItems);
        })
        ['catch'](function (err) {
          self.state.loading = false;
          self.state.error = err;
          self.config.onStateChange({ loading: false, error: err, page: self.state.page, hasMore: self.state.hasMore });
          self.config.onError(err);
          resolve([]);
        });
    });
  };

  PMOSPagination.prototype.getState = function () {
    return {
      page: this.state.page,
      pages: this.state.pages,
      hasMore: this.state.hasMore,
      loading: this.state.loading,
      error: this.state.error,
      totalFetched: this.state.totalFetched
    };
  };

  PMOSPagination.prototype.getAllItems = function () {
    var all = [];
    this.state.pages.forEach(function (page) {
      all = all.concat(page);
    });
    return all;
  };

  window.PMOSPagination = PMOSPagination;
})();
