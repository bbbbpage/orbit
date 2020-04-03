import Orbit, { Evented } from '@orbit/core';
import {
  QueryExpression,
  FindRecord,
  FindRecords,
  FindRelatedRecord,
  FindRelatedRecords,
  equalRecordIdentities,
  Query,
  Schema,
  RecordOperation
} from '@orbit/data';

import { RecordChange, recordOperationChange } from './record-change';

const { assert } = Orbit;

export interface LiveQuerySettings {
  debounce: boolean;
  query: Query;
}

export abstract class LiveQuery {
  readonly debounce: boolean;
  protected cache: Evented;
  protected schema: Schema;

  protected _query: Query;
  protected _subscribe(onNext: () => void): () => void {
    const execute = this.debounce ? onceTick(onNext) : onNext;

    const unsubscribePatch = this.cache.on(
      'patch',
      (operation: RecordOperation) => {
        if (this.operationRelevantForQuery(operation)) {
          execute();
        }
      }
    );

    const unsubscribeReset = this.cache.on('reset', () => {
      execute();
    });

    function unsubscribe() {
      cancelTick(execute);
      unsubscribePatch();
      unsubscribeReset();
    }

    return unsubscribe;
  }

  constructor(settings: LiveQuerySettings) {
    assert(
      'Only single expression queries are supported on LiveQuery',
      settings.query.expressions.length === 1
    );
    this.debounce = settings.debounce;
    this._query = settings.query;
  }

  operationRelevantForQuery(operation: RecordOperation): boolean {
    const change = recordOperationChange(operation);
    const expression = this._query.expressions[0];
    return this.queryExpressionRelevantForChange(expression, change);
  }

  protected queryExpressionRelevantForChange(
    expression: QueryExpression,
    change: RecordChange
  ): boolean {
    switch (expression.op) {
      case 'findRecord':
        return this.findRecordQueryExpressionRelevantForChange(
          expression as FindRecord,
          change
        );
      case 'findRecords':
        return this.findRecordsQueryExpressionRelevantForChange(
          expression as FindRecords,
          change
        );
      case 'findRelatedRecord':
        return this.findRelatedRecordQueryExpressionRelevantForChange(
          expression as FindRelatedRecord,
          change
        );
      case 'findRelatedRecords':
        return this.findRelatedRecordsQueryExpressionRelevantForChange(
          expression as FindRelatedRecords,
          change
        );
      default:
        return true;
    }
  }

  protected findRecordQueryExpressionRelevantForChange(
    expression: FindRecord,
    change: RecordChange
  ): boolean {
    return equalRecordIdentities(expression.record, change);
  }

  protected findRecordsQueryExpressionRelevantForChange(
    expression: FindRecords,
    change: RecordChange
  ): boolean {
    if (expression.type) {
      return expression.type === change.type;
    } else if (expression.records) {
      for (let record of expression.records) {
        if (record.type === change.type) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  protected findRelatedRecordQueryExpressionRelevantForChange(
    expression: FindRelatedRecord,
    change: RecordChange
  ): boolean {
    return (
      equalRecordIdentities(expression.record, change) &&
      (change.relationships.includes(expression.relationship) || change.remove)
    );
  }

  protected findRelatedRecordsQueryExpressionRelevantForChange(
    expression: FindRelatedRecords,
    change: RecordChange
  ): boolean {
    const { type } = this.schema.getRelationship(
      expression.record.type,
      expression.relationship
    );

    if (Array.isArray(type) && type.find((type) => type === change.type)) {
      return true;
    } else if (type === change.type) {
      return true;
    }

    return (
      equalRecordIdentities(expression.record, change) &&
      (change.relationships.includes(expression.relationship) || change.remove)
    );
  }
}

const isNode =
  typeof process === 'object' && typeof process.nextTick === 'function';
let resolvedPromise: Promise<void>;
const nextTick = isNode
  ? function (fn: () => void) {
      if (!resolvedPromise) {
        resolvedPromise = Promise.resolve();
      }
      resolvedPromise.then(() => {
        process.nextTick(fn);
      });
    }
  : window.setImmediate || setTimeout;

function onceTick(fn: () => void) {
  return function tick() {
    if (!ticks.has(tick)) {
      ticks.add(tick);
      nextTick(() => {
        fn();
        cancelTick(tick);
      });
    }
  };
}

function cancelTick(tick: () => void) {
  ticks.delete(tick);
}

const ticks = new WeakSet();
