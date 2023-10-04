import { sanitize } from '@strapi/utils';
import { PaginationBaseQuery } from '../config/querySchema';
import {
  Entity,
  Model,
  Result,
  ResultsResponse,
  TransformedPagination,
} from '../interfaces/interfaces';
import {
  paginateGraphQlResults,
  paginateRestResults,
} from './paginationService';

const { contentAPI } = sanitize;

const sanitizeOutput = (data: any, contentType: Model, auth: any) =>
  contentAPI.output(data, contentType, { auth });

// Destructure search results and return them in appropriate/sanitized format
export const buildGraphqlResponse = async (
  searchResult: Result,
  auth: Record<string, unknown>,
  pagination?: TransformedPagination
) => {
  const { service: getService } = strapi.plugin('graphql');
  const { returnTypes } = getService('format');
  const { toEntityResponseCollection } = returnTypes;
  const { fuzzysortResults, uid } = searchResult;

  const results = await Promise.all(
    fuzzysortResults.map(async (fuzzyRes) => {
      const schema = strapi.getModel(uid);

      const sanitizedEntity: Record<string, unknown> = (await sanitizeOutput(
        fuzzyRes.obj,
        schema,
        auth
      )) as Record<string, unknown>;

      return sanitizedEntity;
    })
  );

  const { data: nodes, meta } = paginateGraphQlResults(results, pagination);
  return toEntityResponseCollection(nodes, {
    args: meta,
    resourceUID: uid,
  });
};

export const buildRestResponse = async (
  searchResults: Result[],
  auth: any,
  pagination: Record<string, PaginationBaseQuery> | null,
  queriedContentTypes?: string[]
) => {
  const resultsResponse: ResultsResponse = {};

  for (const res of searchResults) {
    const sanitizeEntry = async (fuzzyRes: Fuzzysort.KeysResult<Entity>) => {
      const schema = strapi.getModel(res.uid);

      return await sanitizeOutput(fuzzyRes.obj, schema, auth);
    };

    const buildSanitizedEntries = async () =>
      res.fuzzysortResults.map(
        async (fuzzyRes) => await sanitizeEntry(fuzzyRes)
      );

    // Since sanitizeOutput returns a promise --> Resolve all promises in async for loop so that results can be awaited correctly
    resultsResponse[res.schemaInfo.pluralName] = (await Promise.all(
      await buildSanitizedEntries()
    )) as Record<string, unknown>[];
  }

  if (!pagination) return resultsResponse;

  const modelNames = queriedContentTypes || Object.keys(pagination);
  return await paginateRestResults(pagination, modelNames, resultsResponse);
};

export default buildRestResponse;
