import fuzzysort from 'fuzzysort';
import { transliterate } from 'transliteration';
import {
  ContentType,
  Entity,
  FilteredEntry,
  Result,
} from '../interfaces/interfaces';
import { validateQuery } from './validationService';

const buildResult = ({
  model,
  keys,
  query,
}: {
  model: FilteredEntry;
  keys: string[];
  query: string;
}) => {
  const { pluralName } = model.schemaInfo;

  if (model.fuzzysortOptions.characterLimit) {
    model[pluralName].forEach((entry) => {
      const entryKeys = Object.keys(entry);

      entryKeys.forEach((key) => {
        if (!keys.includes(key)) return;

        if (!entry[key]) return;

        entry[key] = entry[key].slice(0, model.fuzzysortOptions.characterLimit);
      });
    });
  }

  return {
    schemaInfo: model.schemaInfo,
    uid: model.uid,
    fuzzysortResults: fuzzysort.go<Entity>(query, model[pluralName], {
      threshold: model.fuzzysortOptions.threshold,
      limit: model.fuzzysortOptions.limit,
      keys,
      scoreFn: (a) =>
        Math.max(
          ...model.fuzzysortOptions.keys.map((key, index) =>
            a[index] ? a[index].score + key.weight : -9999
          )
        ),
    }),
  };
};

const buildTransliteratedResult = ({
  model,
  keys,
  query,
  result,
}: {
  model: FilteredEntry;
  keys: string[];
  query: string;
  result: Result;
}): Result => {
  const { pluralName } = model.schemaInfo;

  /**
   * Transliterate relevant fields for the entry
   */
  model[pluralName].forEach((entry) => {
    const entryKeys = Object.keys(entry);

    entry.transliterations = {};

    entryKeys.forEach((key) => {
      if (!keys.includes(key) || !entry[key]) return;

      entry.transliterations[key] = transliterate(entry[key]);
    });
  });

  const transliterationKeys = keys.map((key) => `transliterations.${key}`);

  const { uid, schemaInfo, fuzzysortOptions } = model;

  const transliteratedResult: Result = {
    uid,
    schemaInfo,
    fuzzysortResults: fuzzysort.go<Entity>(query, model[pluralName], {
      threshold: fuzzysortOptions.threshold,
      limit: fuzzysortOptions.limit,
      keys: transliterationKeys,
      scoreFn: (a) =>
        Math.max(
          ...fuzzysortOptions.keys.map((key, index) =>
            a[index] ? a[index].score + key.weight : -9999
          )
        ),
    }),
  };

  const previousResults = result.fuzzysortResults;

  if (!previousResults.total) return transliteratedResult;

  const newResults = [...previousResults] as any[];

  // In the chance that a transliterated result scores higher than its non-transliterated counterpart,
  // overwrite the original result with the transliterated result and resort the results
  transliteratedResult.fuzzysortResults.forEach((res) => {
    const origIndex = previousResults.findIndex(
      (origRes) => origRes.obj.id === res.obj.id && origRes.score <= res.score
    );

    if (origIndex >= 0) newResults[origIndex] = res;
  });

  newResults.sort((a, b) => b.score - a.score);

  return result;
};

export default async function getResult(
  contentType: ContentType,
  query: string,
  filters?: Record<string, unknown>,
  locale?: string
) {
  const buildFilteredEntry = async () => {
    await validateQuery(contentType, locale);

    const items = await strapi.entityService.findMany(contentType.model.uid, {
      ...(filters && { filters }),
      ...(locale && { locale }),
    });

    return {
      uid: contentType.uid,
      modelName: contentType.modelName,
      schemaInfo: contentType.model.info,
      transliterate: contentType.transliterate,
      fuzzysortOptions: contentType.fuzzysortOptions,
      [contentType.model.info.pluralName]: items,
    };
  };

  const filteredEntry: FilteredEntry = await buildFilteredEntry();

  const keys = filteredEntry.fuzzysortOptions.keys.map((key) => key.name);

  let result = buildResult({ model: filteredEntry, keys, query });

  if (filteredEntry.transliterate) {
    result = buildTransliteratedResult({
      model: filteredEntry,
      keys,
      query,
      result,
    });
  }

  return result;
}
