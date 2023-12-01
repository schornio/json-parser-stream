const whitespace = new Set([' ', '\t', '\n', '\r']);

const digits = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
const digitsWithDot = new Set(['.', ...digits]);

const trueString = 'true';
const falseString = 'false';
const nullString = 'null';

export class JSONParserStream {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.#stream = new TransformStream<string>({
      flush(controller) {
        if (self.#heldBackChunk) {
          controller.enqueue(self.#heldBackChunk);
        }
      },
      transform(chunk, controller) {
        let newChunk = '';

        for (const character of chunk) {
          const result = self.#processCharacter(character);
          if ('flushedChunk' in result) {
            newChunk += result.flushedChunk;
          }
          if (
            'newObjectDataAvailable' in result &&
            result.newObjectDataAvailable
          ) {
            self.#parseHeldBackChunk();
          }
        }
        controller.enqueue(newChunk);
      },
    });
  }

  getStream() {
    return this.#stream;
  }

  #onObjectCallbacks: ((object: Record<string, unknown>) => void)[] = [];
  onObject(callback: (object: Record<string, unknown>) => void) {
    this.#onObjectCallbacks.push(callback);
  }
  #objectDispatch(object: Record<string, unknown>) {
    this.#onObjectCallbacks.forEach((callback) => callback(object));
  }

  #onCompletedCallbacks: ((object: Record<string, unknown>) => void)[] = [];
  onObjectCompleted(callback: (object: Record<string, unknown>) => void) {
    this.#onCompletedCallbacks.push(callback);
  }
  #objectCompletedDispatch(object: Record<string, unknown>) {
    this.#onCompletedCallbacks.forEach((callback) => callback(object));
  }

  #parseHeldBackChunk(options?: { completed?: boolean }) {
    const sanitzedHeldBackChunk =
      this.#state === 'STRING_START'
        ? this.#heldBackChunk
        : this.#heldBackChunk.replace(/[\s,]+$/u, '');
    if (sanitzedHeldBackChunk.length > 0) {
      const data = JSON.parse(
        sanitzedHeldBackChunk + this.#expectedClosingCharacters.join(''),
      ) as Record<string, unknown>;
      if (options?.completed) {
        this.#objectCompletedDispatch(data);
      } else {
        this.#objectDispatch(data);
      }
    }
  }

  #stream;

  #heldBackChunk = '';
  #state:
    | 'TEXT'
    | 'OBJECT_START'
    | 'NEXT_VALUE'
    | 'KEY_START'
    | 'KEY_END'
    | 'COLON'
    | 'VALUE_START'
    | 'STRING_START'
    | 'NUMBER_START'
    | 'NEGATIVE_NUMBER_START'
    | 'TRUE_START'
    | 'FALSE_START'
    | 'NULL_START' = 'TEXT';

  #expectedClosingCharacters: string[] = [];

  #nextStringCharacterIsEscaped = false;

  #flushHeldBackChunk() {
    const flushedChunk = this.#heldBackChunk;
    this.#state = 'TEXT';
    this.#heldBackChunk = '';
    this.#expectedClosingCharacters = [];
    return { flushedChunk };
  }

  #processCharacter(
    character: string,
    sameCharacterAsBefore = false,
  ): { flushedChunk: string } | { newObjectDataAvailable: boolean } {
    if (!sameCharacterAsBefore) {
      this.#heldBackChunk += character;
    }

    switch (this.#state) {
      case 'TEXT':
        if (character === '{') {
          this.#expectedClosingCharacters = ['}'];
          this.#state = 'OBJECT_START';
          return { newObjectDataAvailable: true };
        }
        return this.#flushHeldBackChunk();
      case 'OBJECT_START':
        if (character === '"') {
          this.#state = 'KEY_START';
          this.#expectedClosingCharacters.unshift('":null');
          return { newObjectDataAvailable: false };
        }
        if (whitespace.has(character)) {
          return { newObjectDataAvailable: false };
        }
        return this.#flushHeldBackChunk();
      case 'NEXT_VALUE': {
        if (whitespace.has(character)) {
          return { newObjectDataAvailable: false };
        }
        if (character === ',') {
          if (this.#expectedClosingCharacters[0] === ']') {
            this.#state = 'VALUE_START';
            return { newObjectDataAvailable: false };
          }
          if (this.#expectedClosingCharacters[0] === '}') {
            this.#state = 'OBJECT_START';
            return { newObjectDataAvailable: false };
          }
        }
        if (character === '}' || character === ']') {
          const expectedClosingCharacter =
            this.#expectedClosingCharacters.shift();

          if (expectedClosingCharacter === character) {
            if (this.#expectedClosingCharacters.length === 0) {
              // Finished parsing
              this.#state = 'TEXT';
              this.#parseHeldBackChunk({ completed: true });
              this.#heldBackChunk = '';
              this.#expectedClosingCharacters = [];
              return { newObjectDataAvailable: true };
            }
            return { newObjectDataAvailable: false };
          }
        }
        return this.#flushHeldBackChunk();
      }
      case 'KEY_START':
        if (character === '"') {
          this.#state = 'COLON';
          const expectedClosingCharacter =
            this.#expectedClosingCharacters.shift();
          if (expectedClosingCharacter === '":null') {
            this.#expectedClosingCharacters.unshift(':null');
            return { newObjectDataAvailable: true };
          }
        }
        return { newObjectDataAvailable: false };
      case 'COLON':
        if (character === ':') {
          this.#state = 'VALUE_START';
          const expectedClosingCharacter =
            this.#expectedClosingCharacters.shift();
          if (expectedClosingCharacter === ':null') {
            this.#expectedClosingCharacters.unshift('null');
            return { newObjectDataAvailable: false };
          }
        }
        if (whitespace.has(character)) {
          return { newObjectDataAvailable: false };
        }
        return this.#flushHeldBackChunk();
      case 'VALUE_START':
        if (whitespace.has(character)) {
          return { newObjectDataAvailable: false };
        }
        if (this.#expectedClosingCharacters[0] === 'null') {
          this.#expectedClosingCharacters.shift();
        }
        if (character === '"') {
          // string
          this.#state = 'STRING_START';
          this.#expectedClosingCharacters.unshift('"');
          return { newObjectDataAvailable: true };
        }
        if (digits.has(character)) {
          // number
          this.#state = 'NUMBER_START';
          return { newObjectDataAvailable: true };
        }
        if (character === '-') {
          // number
          this.#state = 'NEGATIVE_NUMBER_START';
          this.#expectedClosingCharacters.unshift('0');
          return { newObjectDataAvailable: true };
        }
        if (character === 't') {
          // true
          this.#state = 'TRUE_START';
          this.#expectedClosingCharacters.unshift(trueString.substring(1));
          return { newObjectDataAvailable: true };
        }
        if (character === 'f') {
          // false
          this.#state = 'FALSE_START';
          this.#expectedClosingCharacters.unshift(falseString.substring(1));
          return { newObjectDataAvailable: true };
        }
        if (character === 'n') {
          // null
          this.#state = 'NULL_START';
          this.#expectedClosingCharacters.unshift(nullString.substring(1));
          return { newObjectDataAvailable: false };
        }
        if (character === '[') {
          // array
          this.#state = 'VALUE_START';
          this.#expectedClosingCharacters.unshift(']');
          return { newObjectDataAvailable: true };
        }
        if (character === '{') {
          // object
          this.#state = 'OBJECT_START';
          this.#expectedClosingCharacters.unshift('}');
          return { newObjectDataAvailable: true };
        }

        return this.#flushHeldBackChunk();
      case 'STRING_START':
        if (character === '\\') {
          this.#nextStringCharacterIsEscaped = true;
          return { newObjectDataAvailable: false };
        }
        if (this.#nextStringCharacterIsEscaped) {
          this.#nextStringCharacterIsEscaped = false;
          return { newObjectDataAvailable: true };
        }
        if (character === '"') {
          this.#state = 'NEXT_VALUE';
          const expectedClosingCharacter =
            this.#expectedClosingCharacters.shift();
          if (expectedClosingCharacter === '"') {
            return { newObjectDataAvailable: false };
          }
        }
        return { newObjectDataAvailable: true };
      case 'NUMBER_START':
        if (digitsWithDot.has(character)) {
          return { newObjectDataAvailable: true };
        } else {
          this.#state = 'NEXT_VALUE';
          return this.#processCharacter(character, true);
        }
      case 'NEGATIVE_NUMBER_START':
        if (digits.has(character)) {
          this.#expectedClosingCharacters.shift();
          this.#state = 'NUMBER_START';
          return { newObjectDataAvailable: true };
        }
        return this.#flushHeldBackChunk();
      case 'TRUE_START': {
        const expectedClosingCharacter =
          this.#expectedClosingCharacters.shift() ?? 'FAIL';
        if (expectedClosingCharacter[0] === character) {
          if (expectedClosingCharacter.length === 1) {
            this.#state = 'NEXT_VALUE';
            return { newObjectDataAvailable: false };
          }
          this.#state = 'TRUE_START';
          this.#expectedClosingCharacters.unshift(
            trueString.substring(trueString.indexOf(character) + 1),
          );
          return { newObjectDataAvailable: false };
        }
        return this.#flushHeldBackChunk();
      }
      case 'FALSE_START': {
        const expectedClosingCharacter =
          this.#expectedClosingCharacters.shift() ?? 'FAIL';
        if (expectedClosingCharacter[0] === character) {
          if (expectedClosingCharacter.length === 1) {
            this.#state = 'NEXT_VALUE';
            return { newObjectDataAvailable: false };
          }
          this.#state = 'FALSE_START';
          this.#expectedClosingCharacters.unshift(
            falseString.substring(falseString.indexOf(character) + 1),
          );
          return { newObjectDataAvailable: false };
        }
        return this.#flushHeldBackChunk();
      }
      case 'NULL_START': {
        const expectedClosingCharacter =
          this.#expectedClosingCharacters.shift() ?? 'FAIL';
        if (expectedClosingCharacter[0] === character) {
          if (expectedClosingCharacter.length === 1) {
            this.#state = 'NEXT_VALUE';
            return { newObjectDataAvailable: false };
          }
          this.#state = 'NULL_START';
          this.#expectedClosingCharacters.unshift(
            nullString.substring(nullString.indexOf(character) + 1),
          );
          return { newObjectDataAvailable: false };
        }
        return this.#flushHeldBackChunk();
      }
    }
    return { newObjectDataAvailable: false };
  }
}
