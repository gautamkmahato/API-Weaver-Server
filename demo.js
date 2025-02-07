const jsf = require('json-schema-generator'); // Library to generate JSON Schema from JSON
const swaggerJSDoc = require('swagger-jsdoc');

/**
 * Converts raw input JSON, output JSON, and parameters into an OpenAPI 3.0 schema.
 * @param {Object} rawInput - The raw input JSON.
 * @param {Object} rawOutput - The raw output JSON.
 * @param {Array} parameters - The parameters (query, path, header, etc.).
 * @returns {Object} - The OpenAPI 3.0 schema.
 */
function generateOpenAPISchema(rawInput, rawOutput, parameters) {
  // Generate JSON Schema from raw input and output
  console.log(rawInput)
  const inputSchema = jsf(rawInput);
  const outputSchema = jsf(rawOutput);
  console.log(inputSchema);

  const openapiDefinition = {
    openapi: '3.0.0',
    info: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Automatically generated OpenAPI 3.0 schema',
    },
    paths: {
      '/example-endpoint': {
        post: {
          summary: 'Example endpoint',
          description: 'This is an example endpoint',
          parameters: parameters,
          requestBody: {
            description: 'Input payload',
            content: {
              'application/json': {
                schema: inputSchema,
              },
            },
            required: true,
          },
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: outputSchema,
                },
              },
            },
          },
        },
      },
    },
  };

  return openapiDefinition;
}

// Example usage
const rawInput = {
  name: 'John Doe',
  age: 30,
  isActive: true,
};

const rawOutput = {
  id: '12345',
  status: 'success',
  timestamp: '2023-10-01T12:00:00Z',
};

const parameters = [
  {
    name: 'x-customer-id',
    in: 'header',
    description: 'Customer ID',
    required: true,
    schema: {
      type: 'string',
    },
  },
  {
    name: 'limit',
    in: 'query',
    description: 'Limit the number of results',
    required: false,
    schema: {
      type: 'integer',
    },
  },
];

const openapiSchema = generateOpenAPISchema(rawInput, rawOutput, parameters);
//console.log(JSON.stringify(openapiSchema, null, 2));

/**
 {
  name: 'John Doe',
  age: 30,
  isActive: true,
  commitDays: ['MON', 'TUE', 'WED'], // Array example
}
  { name: 'John Doe', age: 30, isActive: true }
 */