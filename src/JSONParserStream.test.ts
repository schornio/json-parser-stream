import { describe, expect, test } from '@jest/globals';
import { JSONParserStream } from './JSONParserStream';

function runJSONParserStream(input: string) {
  const jsonParserStream = new JSONParserStream();

  const completedObjects: unknown[] = [];
  const objectStates: unknown[][] = [];
  let currentObjectStateIndex = -1;

  jsonParserStream.onObjectCompleted((object) => {
    completedObjects.push(object);
    currentObjectStateIndex += 1;
  });

  jsonParserStream.onObject((object) => {
    if (currentObjectStateIndex === -1) {
      objectStates.push([object]);
      currentObjectStateIndex = 0;
    } else {
      objectStates[currentObjectStateIndex]?.push(object);
    }
  });

  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });

  let streamOutput = '';
  const writableStream = new WritableStream({
    write(chunk) {
      streamOutput += chunk;
    },
  });

  return readableStream
    .pipeThrough(jsonParserStream.getStream())
    .pipeTo(writableStream)
    .then(() => ({ completedObjects, objectStates, streamOutput }));
}

describe('JSONParserStream', () => {
  test('should parse a simple JSON string', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key":"value"}');
    expect(completedObjects).toEqual([{ key: 'value' }]);
    expect(streamOutput).toBe('');
  });

  test('should parse a simple JSON string with a nested object', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":{"nestedKey":"nestedValue"}}',
    );
    expect(completedObjects).toEqual([{ key: { nestedKey: 'nestedValue' } }]);
    expect(streamOutput).toBe('');
  });

  test('should parse a simple JSON string with an array', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":["value1","value2"]}',
    );
    expect(completedObjects).toEqual([{ key: ['value1', 'value2'] }]);
    expect(streamOutput).toBe('');
  });

  test('should parse a simple JSON string with an array of objects', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":[{"nestedKey1":"nestedValue1"},{"nestedKey2":"nestedValue2"}]}',
    );
    expect(completedObjects).toEqual([
      { key: [{ nestedKey1: 'nestedValue1' }, { nestedKey2: 'nestedValue2' }] },
    ]);
    expect(streamOutput).toBe('');
  });

  test('should parse a simple JSON string with multiple objects', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":"value"}{"key":"value"}',
    );
    expect(completedObjects).toEqual([{ key: 'value' }, { key: 'value' }]);
    expect(streamOutput).toBe('');
  });

  test('should ignore whitespace', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{  "key"  :  "value", "array": [  "value1"  ,  "value2"  ]  }',
    );
    expect(completedObjects).toEqual([
      { array: ['value1', 'value2'], key: 'value' },
    ]);
    expect(streamOutput).toBe('');
  });

  test('should handle strings with escaped characters', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":"\\"value\\""}',
    );
    expect(completedObjects).toEqual([{ key: '"value"' }]);
    expect(streamOutput).toBe('');
  });

  test('should parse numbers', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":123,"array":[1,2]}',
    );
    expect(completedObjects).toEqual([{ array: [1, 2], key: 123 }]);
    expect(streamOutput).toBe('');
  });
  test('should parse negative numbers', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":-123,"array":[-1,-2]}',
    );
    expect(completedObjects).toEqual([{ array: [-1, -2], key: -123 }]);
    expect(streamOutput).toBe('');
  });

  test('should parse booleans', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":true,"array":[true,false]}',
    );
    expect(completedObjects).toEqual([{ array: [true, false], key: true }]);
    expect(streamOutput).toBe('');
  });

  test('should parse null', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":null,"array":[null]}',
    );
    expect(completedObjects).toEqual([{ array: [null], key: null }]);
    expect(streamOutput).toBe('');
  });

  test('should pipe through non-JSON content', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":"value"}non-json{"key":"value"}',
    );
    expect(completedObjects).toEqual([{ key: 'value' }, { key: 'value' }]);
    expect(streamOutput).toBe('non-json');
  });

  test('should parse a JSON string split in half', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":"value"}{"key":"value',
    );
    expect(completedObjects).toEqual([{ key: 'value' }]);
    expect(streamOutput).toBe('{"key":"value');
  });

  test('should pipe through malformed JSON content - object', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{{"key":"value"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{{"key":"value"}');
  });

  test('should pipe through malformed JSON content - object key', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key"_:"value"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key"_:"value"}');
  });

  test('should pipe through malformed JSON content - object value', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key":value"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key":value"}');
  });

  test('should pipe through malformed JSON content - between values', async () => {
    const { completedObjects, streamOutput } = await runJSONParserStream(
      '{"key":"value"asdf"key2":"value"}',
    );
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key":"value"asdf"key2":"value"}');
  });

  test('should pipe through malformed JSON content - negative number', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key":-value"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key":-value"}');
  });

  test('should pipe through malformed JSON content - true', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key":ttrue"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key":ttrue"}');
  });

  test('should pipe through malformed JSON content - false', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key":ffalse"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key":ffalse"}');
  });

  test('should pipe through malformed JSON content - null', async () => {
    const { completedObjects, streamOutput } =
      await runJSONParserStream('{"key":nnull"}');
    expect(completedObjects).toEqual([]);
    expect(streamOutput).toBe('{"key":nnull"}');
  });

  test('should emit onObject event only if new data is available', async () => {
    const { objectStates } = await runJSONParserStream(
      '   {   "k1"   :   "v1",   "k2":   null,   "longKey": null   }    ',
    );
    expect(objectStates).toEqual([
      [
        {},
        { k1: null },
        { k1: '' },
        { k1: 'v' },
        { k1: 'v1' },
        { k1: 'v1', k2: null },
        { k1: 'v1', k2: null, longKey: null },
      ],
    ]);
  });
});
