// eslint-disable-next-line import/no-unassigned-import,import/order
import 'dotenv/config.js';
import path, { dirname } from 'path';
import util from 'util';
import { fileURLToPath } from 'url';
import fs from 'fs';
import assert from 'assert';
import { Agent } from 'http';
import { FormData } from 'formdata-node';
import standardFetch, { Request as StandardFetchRequest } from 'node-fetch';
import FetchCache, {
  cacheStrategies,
  FetchResource,
  NFCResponse,
  calculateCacheKey,
  ISynchronizationStrategy,
} from '../../src/index.js';
import { RedisCache } from './redis_cache.js';
import { Redis } from 'ioredis';

const MIN_NODE_VERSION = 16;
const httpBinBaseUrl = 'http://localhost:3000';
const __dirname = dirname(fileURLToPath(import.meta.url));
const wait = util.promisify(setTimeout);
const redisClient = new Redis();

const expectedPngBuffer = fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'expected_png.png'));

const TWO_HUNDRED_URL = `${httpBinBaseUrl}/status/200`;
const FOUR_HUNDRED_URL = `${httpBinBaseUrl}/status/400`;
const FIVE_HUNDRED_URL = `${httpBinBaseUrl}/status/500`;
const THREE_HUNDRED_TWO_URL = `${httpBinBaseUrl}/status/302`;
const TEXT_BODY_URL = `${httpBinBaseUrl}/robots.txt`;
const JSON_BODY_URL = `${httpBinBaseUrl}/json`;
const PNG_BODY_URL = `${httpBinBaseUrl}/image/png`;
const HUNDRED_THOUSAND_BYTES_URL = `${httpBinBaseUrl}/stream-bytes/100000?chunk_size=10000`;

const TEXT_BODY_EXPECTED = 'User-agent: *\nDisallow: /deny\n';
const JSON_BODY_EXPECTED = `{
  "slideshow": {
    "author": "Yours Truly", 
    "date": "date of publication", 
    "slides": [
      {
        "title": "Wake up to WonderWidgets!", 
        "type": "all"
      }, 
      {
        "items": [
          "Why <em>WonderWidgets</em> are great", 
          "Who <em>buys</em> WonderWidgets"
        ], 
        "title": "Overview", 
        "type": "all"
      }
    ], 
    "title": "Sample Slide Show"
  }
}
`;

let defaultCachedFetch: typeof FetchCache;
let defaultCache: RedisCache;

function post(body: string | URLSearchParams | FormData | fs.ReadStream) {
  return { method: 'POST', body };
}

function removeDates(arrayOrObject: { date?: unknown } | string[] | string[][]) {
  if (Array.isArray(arrayOrObject)) {
    if (Array.isArray(arrayOrObject[0])) {
      return arrayOrObject.filter(element => element[0] !== 'date');
    }

    return (arrayOrObject as string[]).filter(element => !Date.parse(element));
  }

  if (arrayOrObject.date) {
    const copy = { ...arrayOrObject };
    delete copy.date;
    return copy;
  }

  return arrayOrObject;
}

async function dualFetch(...args: Parameters<typeof standardFetch>) {
  const [cachedFetchResponse, standardFetchResponse] = await Promise.all([
    defaultCachedFetch(...args),
    standardFetch(...args),
  ]);

  return { cachedFetchResponse, standardFetchResponse };
}

beforeEach(async () => {
  await redisClient.flushall();
  defaultCache = new RedisCache(undefined, redisClient);
  defaultCachedFetch = FetchCache.create({ cache: defaultCache });
});

let response: NFCResponse;

describe('REDIS Plugin Tests', function() {
  const nodeMajorVersion = Number(process.versions.node.split('.')[0]);
  if (nodeMajorVersion < MIN_NODE_VERSION) {
    console.warn(`Skipping Redis tests because Node.js version is less than ${MIN_NODE_VERSION}`);
    return;
  }

  describe('REDIS Basic property tests', () => {
    it('Has a status property', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.status, standardFetchResponse.status);
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.status, standardFetchResponse.status);
    });
  
    it('Has a statusText property', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.statusText, standardFetchResponse.statusText);
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.statusText, standardFetchResponse.statusText);
    });
  
    it('Has a url property', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.url, standardFetchResponse.url);
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.url, standardFetchResponse.url);
    });
  
    it('Has an ok property', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.ok, standardFetchResponse.ok);
      assert.strictEqual(cachedFetchResponse.status, standardFetchResponse.status);
  
      cachedFetchResponse = await defaultCachedFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(cachedFetchResponse.ok, standardFetchResponse.ok);
      assert.strictEqual(cachedFetchResponse.status, standardFetchResponse.status);
    });
  
    it('Has a redirected property', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(THREE_HUNDRED_TWO_URL);
      assert.strictEqual(cachedFetchResponse.redirected, standardFetchResponse.redirected);
  
      cachedFetchResponse = await defaultCachedFetch(THREE_HUNDRED_TWO_URL);
      assert.strictEqual(cachedFetchResponse.redirected, standardFetchResponse.redirected);
    });
  }).timeout(10_000);
  
  describe('REDIS Header tests', () => {
    it('Gets correct raw headers', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        removeDates(cachedFetchResponse.headers.raw()),
        removeDates(standardFetchResponse.headers.raw()),
      );
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        removeDates(cachedFetchResponse.headers.raw()),
        removeDates(standardFetchResponse.headers.raw()),
      );
    });
  
    it('Gets correct header keys', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual([...cachedFetchResponse.headers.keys()], [...standardFetchResponse.headers.keys()]);
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual([...cachedFetchResponse.headers.keys()], [...standardFetchResponse.headers.keys()]);
    });
  
    it('Gets correct header values', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        removeDates([...cachedFetchResponse.headers.values()]),
        removeDates([...standardFetchResponse.headers.values()]),
      );
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        removeDates([...cachedFetchResponse.headers.values()]),
        removeDates([...standardFetchResponse.headers.values()]),
      );
    });
  
    it('Gets correct header entries', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        removeDates([...cachedFetchResponse.headers.entries()]),
        removeDates([...standardFetchResponse.headers.entries()]),
      );
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        removeDates([...cachedFetchResponse.headers.entries()]),
        removeDates([...standardFetchResponse.headers.entries()]),
      );
    });
  
    it('Can get a header by value', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert(standardFetchResponse.headers.get('content-length'));
      assert.deepStrictEqual(
        cachedFetchResponse.headers.get('content-length'),
        standardFetchResponse.headers.get('content-length'),
      );
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        cachedFetchResponse.headers.get('content-length'),
        standardFetchResponse.headers.get('content-length'),
      );
    });
  
    it('Returns undefined for non-existent header', async () => {
      const headerName = 'zzzz';
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert(!standardFetchResponse.headers.get(headerName));
      assert.deepStrictEqual(cachedFetchResponse.headers.get(headerName), standardFetchResponse.headers.get(headerName));
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(cachedFetchResponse.headers.get(headerName), standardFetchResponse.headers.get(headerName));
    });
  
    it('Can get whether a header is present', async () => {
      let { cachedFetchResponse, standardFetchResponse } = await dualFetch(TWO_HUNDRED_URL);
      assert(standardFetchResponse.headers.has('content-length'));
      assert.deepStrictEqual(
        cachedFetchResponse.headers.has('content-length'),
        standardFetchResponse.headers.has('content-length'),
      );
  
      cachedFetchResponse = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.deepStrictEqual(
        cachedFetchResponse.headers.has('content-length'),
        standardFetchResponse.headers.has('content-length'),
      );
    });
  }).timeout(10_000);
  
  describe('REDIS Cache tests', () => {
    it('Uses cache', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can eject from cache', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
  
      await response.ejectFromCache();
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Does not error if ejecting from cache twice', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      await response.ejectFromCache();
      await response.ejectFromCache();
    });
  
    it('Gives different string bodies different cache keys', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post('a'));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post('b'));
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Gives same string bodies same cache keys', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post('a'));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post('a'));
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Gives different URLSearchParams different cache keys', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(new URLSearchParams('a=a')));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(new URLSearchParams('a=b')));
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Gives same URLSearchParams same cache keys', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(new URLSearchParams('a=a')));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(new URLSearchParams('a=a')));
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Gives different read streams different cache keys', async () => {
      const s1 = fs.createReadStream(path.join(__dirname, '..', '..', 'test', 'expected_png.png'));
      const s2 = fs.createReadStream(path.join(__dirname, '..', '..', 'test', '..', 'src', 'index.ts'));
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(s1));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(s2));
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Gives the same read streams the same cache key', async () => {
      const s1 = fs.createReadStream(path.join(__dirname, '..', '..', 'test', 'expected_png.png'));
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(s1));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(s1));
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Gives different form data different cache keys', async () => {
      const data1 = new FormData();
      data1.append('a', 'a');
  
      const data2 = new FormData();
      data2.append('b', 'b');
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(data1));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(data2));
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Gives same form data same cache keys', async () => {
      const data1 = new FormData();
      data1.append('a', 'a');
  
      const data2 = new FormData();
      data2.append('a', 'a');
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(data1));
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL, post(data2));
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Does not error with custom agent with circular properties', async () => {
      const agent = new Agent();
      (agent as any).agent = agent;
  
      await defaultCachedFetch(TWO_HUNDRED_URL, { agent });
    });
  
    it('Can use a client-provided custom cache key', async () => {
      const cacheFunction = async (resource: FetchResource) => {
        if (resource instanceof StandardFetchRequest) {
          return resource.url;
        }
  
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        return resource.toString();
      };
  
      const cachedFetch = FetchCache.create({ cache: defaultCache, calculateCacheKey: cacheFunction });
      const response1 = await cachedFetch(TWO_HUNDRED_URL, { headers: { XXX: 'YYY' } });
      const response2 = await cachedFetch(TWO_HUNDRED_URL, { headers: { XXX: 'ZZZ' } });
  
      assert.strictEqual(response1.returnedFromCache, false);
      assert.strictEqual(response2.returnedFromCache, true);
  
      const response3 = await cachedFetch(FOUR_HUNDRED_URL, { headers: { XXX: 'YYY' } });
      assert.strictEqual(response3.returnedFromCache, false);
    });
  
    it('Supports TTL', async () => {
      defaultCachedFetch = FetchCache.create({ cache: new RedisCache({ ttl: 100 }, redisClient) });
      let response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
  
      await wait(200);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Can get PNG buffer body', async () => {
      defaultCachedFetch = FetchCache.create({ cache: new RedisCache(undefined, redisClient) });
      response = await defaultCachedFetch(PNG_BODY_URL);
      const body1 = await response.buffer();
      assert.strictEqual(expectedPngBuffer.equals(body1), true);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(PNG_BODY_URL);
      const body2 = await response.buffer();
      assert.strictEqual(expectedPngBuffer.equals(body2), true);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can eject from cache', async () => {
      defaultCachedFetch = FetchCache.create({ cache: new RedisCache(undefined, redisClient) });
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
  
      await response.ejectFromCache();
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
    });
  }).timeout(10_000);
  
  describe('REDIS Data tests', () => {
    it('Supports request objects', async () => {
      let request = new StandardFetchRequest('https://google.com', { body: 'test', method: 'POST' });
      response = await defaultCachedFetch(request);
      assert.strictEqual(response.returnedFromCache, false);
  
      request = new StandardFetchRequest('https://google.com', { body: 'test', method: 'POST' });
      response = await defaultCachedFetch(request);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Supports request objects with custom headers', async () => {
      const request1 = new StandardFetchRequest(TWO_HUNDRED_URL, { headers: { XXX: 'YYY' } });
      const request2 = new StandardFetchRequest(TWO_HUNDRED_URL, { headers: { XXX: 'ZZZ' } });
  
      response = await defaultCachedFetch(request1);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(request2);
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Refuses to consume body twice', async () => {
      response = await defaultCachedFetch(TEXT_BODY_URL);
      await response.text();
      await assert.rejects(async () => response.text(), /body used already for:/);
    });
  
    it('Can get text body', async () => {
      response = await defaultCachedFetch(TEXT_BODY_URL);
      const body1 = await response.text();
      assert.strictEqual(body1, TEXT_BODY_EXPECTED);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TEXT_BODY_URL);
      const body2 = await response.text();
      assert.strictEqual(body2, TEXT_BODY_EXPECTED);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can get JSON body', async () => {
      response = await defaultCachedFetch(JSON_BODY_URL);
      const body1 = (await response.json()) as { slideshow: unknown };
      assert(body1?.slideshow);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(JSON_BODY_URL);
      const body2 = (await response.json()) as { slideshow: unknown };
      assert(body2.slideshow);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can get PNG buffer body', async () => {
      response = await defaultCachedFetch(PNG_BODY_URL);
      const body1 = await response.buffer();
      assert.strictEqual(expectedPngBuffer.equals(body1), true);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(PNG_BODY_URL);
      const body2 = await response.buffer();
      assert.strictEqual(expectedPngBuffer.equals(body2), true);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can stream a body', async () => {
      response = await defaultCachedFetch(TEXT_BODY_URL);
      let body = '';
  
      for await (const chunk of response.body ?? []) {
        body += chunk.toString();
      }
  
      assert.strictEqual(TEXT_BODY_EXPECTED, body);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await defaultCachedFetch(TEXT_BODY_URL);
      body = '';
  
      for await (const chunk of response.body ?? []) {
        body += chunk.toString();
      }
  
      assert.strictEqual(TEXT_BODY_EXPECTED, body);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Errors if the body type is not supported', async () => {
      await assert.rejects(
        async () => defaultCachedFetch(TEXT_BODY_URL, { body: 1 as unknown as string }),
        /Unsupported body type/,
      );
    });
  
    it('Errors if the resource type is not supported', async () => {
      await assert.rejects(
        async () => defaultCachedFetch(1 as unknown as string),
        /The first argument to fetch must be either a string or a node-fetch Request instance/,
      );
    });
  
    it('Uses cache even if you make multiple requests at the same time', async () => {
      const [response1, response] = await Promise.all([
        defaultCachedFetch(TWO_HUNDRED_URL),
        defaultCachedFetch(TWO_HUNDRED_URL),
      ]);
  
      // One should be false, the other should be true
      assert(response1.returnedFromCache !== response.returnedFromCache);
    });
  
    it('Allows a custom synchronization strategy', async () => {
      const bogusSynchronizationStrategy: ISynchronizationStrategy = {
        doWithExclusiveLock: async (_, action) => action(),
      };
  
      defaultCachedFetch = FetchCache.create({
        cache: new RedisCache(undefined, redisClient),
        synchronizationStrategy: bogusSynchronizationStrategy,
      });
  
      const responses = await Promise.all(
        Array(10)
          .fill(0)
          .map(async () => defaultCachedFetch(TWO_HUNDRED_URL)),
      );

      // Since our bogus synchronization strategy doesn't actually synchronize,
      // at least two responses should be cache misses (this depends on random
      // timing and might be a little flaky).
      assert(responses.filter(response => !response.returnedFromCache).length > 1);
    });
  
    it('Can stream a hundred thousand bytes to a file in ten chunks', async () => {
      defaultCachedFetch = FetchCache.create({ cache: new RedisCache(undefined, redisClient) });
  
      const initialResponse = await defaultCachedFetch(HUNDRED_THOUSAND_BYTES_URL);
      assert(initialResponse.ok);
      assert(!initialResponse.returnedFromCache);
  
      const initialResponseBuffer = await initialResponse.buffer();
      assert.equal(initialResponseBuffer.length, 100_000);
  
      const secondResponse = await defaultCachedFetch(HUNDRED_THOUSAND_BYTES_URL);
      assert(secondResponse.ok);
      assert(secondResponse.returnedFromCache);
  
      const secondResponseBuffer = await secondResponse.buffer();
      assert.equal(secondResponseBuffer.length, 100_000);
    });
  }).timeout(10_000);
  
  describe('REDIS Cache mode tests', () => {
    it('Can use the only-if-cached cache control setting via init', async () => {
      response = await defaultCachedFetch(TWO_HUNDRED_URL, { headers: { 'Cache-Control': 'only-if-cached' } });
      assert(response.status === 504 && response.isCacheMiss);
      response = await defaultCachedFetch(TWO_HUNDRED_URL, { headers: { 'Cache-Control': 'only-if-cached' } });
      assert(response.status === 504 && response.isCacheMiss);
      response = await defaultCachedFetch(TWO_HUNDRED_URL);
      assert(response && !response.returnedFromCache);
      response = await defaultCachedFetch(TWO_HUNDRED_URL, { headers: { 'Cache-Control': 'only-if-cached' } });
      assert(response?.returnedFromCache);
      await response.ejectFromCache();
      response = await defaultCachedFetch(TWO_HUNDRED_URL, { headers: { 'Cache-Control': 'only-if-cached' } });
      assert(response.status === 504 && response.isCacheMiss);
    });
  
    it('Can use the only-if-cached cache control setting via resource', async () => {
      response = await defaultCachedFetch(
        new StandardFetchRequest(TWO_HUNDRED_URL, { headers: { 'Cache-Control': 'only-if-cached' } }),
      );
      assert(response.status === 504 && response.isCacheMiss);
      response = await defaultCachedFetch(new StandardFetchRequest(TWO_HUNDRED_URL));
      assert(response && !response.returnedFromCache);
      response = await defaultCachedFetch(
        new StandardFetchRequest(TWO_HUNDRED_URL, { headers: { 'Cache-Control': 'only-if-cached' } }),
      );
      assert(response?.returnedFromCache);
    });
  
    it('Works with only-if-cached along with other cache-control directives', async () => {
      response = await defaultCachedFetch(
        new StandardFetchRequest(TWO_HUNDRED_URL, { headers: { 'cAcHe-cOnTrOl': '   only-if-cached  , no-store ' } }),
      );
      assert(response.status === 504 && response.isCacheMiss);
      response = await defaultCachedFetch(TWO_HUNDRED_URL, {
        headers: { 'cAcHe-cOnTrOl': '   only-if-cached  , no-store ' },
      });
      assert(response.status === 504 && response.isCacheMiss);
    });
  });
  
  describe('REDIS Cache key tests', () => {
    it('Can calculate a cache key and check that it exists', async () => {
      await defaultCachedFetch(TWO_HUNDRED_URL);
  
      const cacheKey = await calculateCacheKey(TWO_HUNDRED_URL);
      const nonExistentCacheKey = await calculateCacheKey(TEXT_BODY_URL);
  
      const cacheKeyResult = await defaultCache.get(cacheKey);
      const nonExistentCacheKeyResult = await defaultCache.get(nonExistentCacheKey);
  
      assert(cacheKeyResult);
      assert(!nonExistentCacheKeyResult);
    });
  });
  
  describe('REDIS Cache strategy tests', () => {
    it('Can use a custom cache strategy to cache only OKAY responses', async () => {
      const customCachedFetch = FetchCache.create({
        cache: defaultCache,
        shouldCacheResponse: cacheStrategies.cacheOkayOnly,
      });
  
      response = await customCachedFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(TWO_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can use a custom cache strategy via the call to fetch to cache only OKAY responses', async () => {
      const customCachedFetch = FetchCache.create({
        cache: defaultCache,
      });
  
      response = await customCachedFetch(FOUR_HUNDRED_URL, undefined, {
        shouldCacheResponse: cacheStrategies.cacheOkayOnly,
      });
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(FOUR_HUNDRED_URL, undefined, {
        shouldCacheResponse: cacheStrategies.cacheOkayOnly,
      });
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(FOUR_HUNDRED_URL, undefined, {
        shouldCacheResponse: cacheStrategies.cacheNon5xxOnly,
      });
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
    });
  
    it('Can use the cacheNon5xxOnly built-in strategy', async () => {
      const customCachedFetch = FetchCache.create({
        cache: defaultCache,
        shouldCacheResponse: cacheStrategies.cacheNon5xxOnly,
      });
  
      response = await customCachedFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(FOUR_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, true);
  
      response = await customCachedFetch(FIVE_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
  
      response = await customCachedFetch(FIVE_HUNDRED_URL);
      assert.strictEqual(response.returnedFromCache, false);
    });
  
    it('Can use a custom cache strategy that uses the response body', async () => {
      const customCachedFetch = FetchCache.create({
        cache: defaultCache,
        async shouldCacheResponse(response) {
          const body = await response.text();
          return Boolean(body);
        },
      });
  
      response = await customCachedFetch(TEXT_BODY_URL);
      assert.strictEqual(response.returnedFromCache, false);
      assert.strictEqual(await response.text(), TEXT_BODY_EXPECTED);
    });
  
    it('Can use a custom cache strategy that uses the response for all response types', async () => {
      const functionsThatUseResponse = ['arrayBuffer', 'blob', 'buffer', 'json', 'text'] as const;
  
      for (const functionName of functionsThatUseResponse) {
        await redisClient.flushall();
  
        response = await defaultCachedFetch(JSON_BODY_URL, undefined, {
          async shouldCacheResponse(response) {
            await response[functionName]();
            return true;
          },
        });
  
        assert.strictEqual(response.returnedFromCache, false);
  
        // Because when the json() function is used all of the whitespace in
        // the response is lost, something a little special happens when we
        // snipe the response body from json(). The cached response will have
        // the whitespace stripped out, even though the original response may
        // not have. This may cause issues for some unusual use cases.
        if (functionName === 'json') {
          assert.strictEqual(await response.text(), JSON.stringify(JSON.parse(JSON_BODY_EXPECTED)));
        } else {
          assert.strictEqual(await response.text(), JSON_BODY_EXPECTED);
        }
      }
    });
  });
  
  describe('REDIS Network error tests', () => {
    it('Bubbles up network errors', async () => {
      await assert.rejects(async () => defaultCachedFetch('http://localhost:1'), /^FetchError:/);
    });
  });
});
