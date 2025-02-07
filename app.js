const express = require('express');
const cors = require('cors');
const $RefParser = require('@apidevtools/json-schema-ref-parser');
const OpenAPISchemaValidator = require('openapi-schema-validator').default;  // OpenAPI validator
const SwaggerParser = require('@apidevtools/swagger-parser');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const jsf = require('json-schema-generator'); // Library to generate JSON Schema from JSON
const swaggerJSDoc = require('swagger-jsdoc');

// Initialize Clerk (automatically reads CLERK_SECRET_KEY from .env)
// No explicit initialization needed if using ClerkExpressRequireAuth
require('dotenv').config();


const app = express();

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json({ limit: '10mb' })); // Parse JSON request bodies with a 10MB limit

// Initialize Supabase client
const supabaseUrl = 'https://cgmkehaxaqzfryllepcv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnbWtlaGF4YXF6ZnJ5bGxlcGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc3OTU4MTIsImV4cCI6MjA1MzM3MTgxMn0.PE4nfhdZE46Z7WSaDRWzXvhsH8MiV1P3-rm5p7_QtSk';
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper Functions

// Function to validate OpenAPI 3.0 JSON data
async function validateOpenApiJson(jsonData) {
    try {
        // Create an OpenAPI 3.0 validator
        const validator = new OpenAPISchemaValidator({
            version: '3.0.0', // specify OpenAPI version 3.0
        });

        // Validate the JSON data against the OpenAPI 3.0 specification
        const result = validator.validate(jsonData);

        // If the validation result is valid, return true
        if (result.errors.length === 0) {
            return { valid: true, errors: [] };
        }

        // If there are errors, return them
        return { valid: false, errors: result.errors };
    } catch (error) {
        // Catch any unexpected errors during validation
        return { valid: false, errors: [error.message] };
    }
}

// async function validateOpenApiSchema(openApiData) {
//   try {
//     await SwaggerParser.validate(openApiData);
//     return { valid: true, errors: [] };
//   } catch (err) {
//     return { valid: false, errors: err };
//   }
// }

/**
 * Validates JSON input against an OpenAPI schema.
 * @param {object} openApiSchema - The OpenAPI schema.
 * @returns {object} - Validation result with `valid` and `errors` properties.
 */
async function validateOpenApiSchema(openApiSchema) {
  try {
    // Validate and dereference the OpenAPI schema
    await SwaggerParser.validate(openApiSchema);

    // If validation succeeds, return no errors
    return {
      valid: true,
      errors: [],
    };
  } catch (err) {
    // If validation fails, extract detailed error messages
    const errors = [];

    if (err.errors) {
      // Handle multiple validation errors
      err.errors.forEach((error) => {
        errors.push({
          message: error.message,
          path: error.path.join('.'),
          schemaPath: error.schemaPath,
          details: error.details,
        });
      });
    } else {
      // Handle single validation error
      errors.push({
        message: err.message,
        path: err.path ? err.path.join('.') : '',
        schemaPath: err.schemaPath || '',
        details: err.details || {},
      });
    }

    return {
      valid: false,
      errors,
    };
  }
}

/**
 * Converts the nested OpenAPI schema into a flattened format.
 * @param {Array} convertedData - The converted OpenAPI data.
 * @returns {Object} - Flattened API data.
 */
async function convertToFlattenedFormat(convertedData) {
  const apiData = {};

  for (const pathObj of convertedData) {
    const [path, methodsArray] = Object.entries(pathObj)[0];
    apiData[path] = {};

    for (const methodObj of methodsArray) {
      const [method, methodData] = Object.entries(methodObj)[0];
      apiData[path][method.toUpperCase()] = methodData;
    }
  }

  return apiData;
}

/**
 * Extracts metadata (paths and methods) from the OpenAPI schema.
 * @param {Object} mySchema - The OpenAPI schema.
 * @returns {Object} - Metadata object.
 */
function getMetaData(mySchema) {
  const myJSON = {};
  const uri = Object.keys(mySchema.paths || {});
  const httpMethods = uri.map((path) => Object.keys(mySchema.paths[path] || {}));

  for (let i = 0; i < uri.length; i++) {
    myJSON[uri[i]] = httpMethods[i];
  }

  return myJSON;
}

/**
 * Converts the OpenAPI schema into a structured format.
 * @param {Object} mySchema - The OpenAPI schema.
 * @returns {Array} - Converted OpenAPI data.
 */
async function convertData(mySchema) {
  try {
    // Dereference the schema to resolve all $refs
    const schema = await $RefParser.dereference(mySchema);

    // Validate schema
    if (!schema.paths || Object.keys(schema.paths).length === 0) {
      throw new Error('Invalid schema: No paths found');
    }

    const myJSON = getMetaData(schema);
    const finalOutput = [];

    for (const x in myJSON) {
      const arr = myJSON[x];
      const methodsData = [];

      for (let i = 0; i < arr.length; i++) {
        const currentMethod = arr[i].toLowerCase();
        if (!schema.paths[x][currentMethod]) {
          console.warn(`Method ${currentMethod} not found for path ${x}`);
          continue;
        }

        const methodDetails = schema.paths[x][currentMethod];

        // Comprehensive response handling
        const responses = methodDetails.responses || {};
        const output = Object.keys(responses)
          .filter((code) => code.startsWith('2'))
          .map((code) => ({
            code,
            content: responses[code].content || {},
            description: responses[code].description || '',
          }));

        // Input handling with improved flexibility
        const input = methodDetails.requestBody?.content || {};

        // Parameters handling
        const parameters = methodDetails.parameters?.map((param) => ({
          name: param.name,
          in: param.in,
          required: param.required,
          description: param.description,
          schema: param.schema,
        })) || [];

        // Error responses handling
        const errorResponses = Object.keys(responses)
          .filter((code) => code.startsWith('4') || code.startsWith('5'))
          .map((code) => ({
            code,
            content: responses[code].content || {},
            description: responses[code].description || '',
          }));

        const obj = {
          [currentMethod]: {
            output,
            input,
            parameters,
            errorResponses,
            operationId: methodDetails.operationId,
            summary: methodDetails.summary,
            description: methodDetails.description,
          },
        };
        methodsData.push(obj);
      }

      const uriObj = {
        [x]: methodsData,
      };
      finalOutput.push(uriObj);
    }

    return finalOutput;
  } catch (err) {
    console.error('Conversion error:', err);
    throw err;
  }
}


/**
 * Enhances the schema with descriptions, examples, and proper array/object handling.
 * @param {Object} data - The raw JSON data.
 * @returns {Object} - The enhanced JSON Schema.
 */
function enhanceSchema(data) {
  const schema = {
    type: 'object',
    properties: {},
    required: [],
  };

  for (const key in data) {
    const value = data[key];
    const property = {};

    // Add description and example
    property.description = `Description for ${key}`;
    property.example = value;

    // Determine the type of the value
    if (Array.isArray(value)) {
      property.type = 'array';
      property.items = {
        type: typeof value[0], // Infer type from the first item in the array
      };
    } else if (typeof value === 'object' && value !== null) {
      property.type = 'object';
      property.properties = enhanceSchema(value).properties; // Recursively handle nested objects
    } else {
      property.type = typeof value;
    }

    schema.properties[key] = property;
    schema.required.push(key);
  }

  return schema;
}

/**
/**
 * Converts raw input JSON, output JSON, and parameters into an OpenAPI 3.0 schema.
 * @param {Object} rawInput - The raw input JSON.
 * @param {Object} rawOutput - The raw output JSON.
 * @param {Array} parameters - The parameters (query, path, header, etc.).
 * @returns {Object} - The OpenAPI 3.0 schema.
 */
async function generateOpenAPISchema(rawInput, rawOutput, parameters) {
  // Generate enhanced JSON Schema from raw input and output
  const inputSchema = enhanceSchema(rawInput);
  const outputSchema = enhanceSchema(rawOutput);

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

// Middleware to verify Clerk JWT token
const verifyClerkToken = async (req, res, next) => {
  try {
    // Get the token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    // Remove 'Bearer ' prefix if present
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    // Your Clerk PEM public key should be set as an environment variable
    const publicKey = process.env.CLERK_PEM_PUBLIC_KEY;
    if (!publicKey) {
      throw new Error('CLERK_PEM_PUBLIC_KEY environment variable is not set');
    }

    // Verify the token
    const options = {
      algorithms: ['RS256'],
    };

    // Validate the token and decode its payload
    const decoded = jwt.verify(token, publicKey, options);

    // Validate expiration and not-before claims
    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp < currentTime) {
      throw new Error('Token has expired');
    }
    if (decoded.nbf > currentTime) {
      throw new Error('Token is not yet valid');
    }

    // Optional: Validate authorized parties (azp claim)
    // Replace these with your actual allowed origins
    const permittedOrigins = ['http://localhost:3000', 'https://yourdomain.com'];
    if (decoded.azp && !permittedOrigins.includes(decoded.azp)) {
      throw new Error('Invalid authorized party (azp claim)');
    }

    // Attach the decoded token to the request object for use in route handlers
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Invalid token',
      details: error.message
    });
  }
};


// POST Endpoint
app.post('/convert/test', async (req, res) => {
  try {
    //console.log('Request Headers:', req.headers); // Log headers
    //console.log('Request Body:', req.body); // Log body

    const { body } = req;

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Validate the incoming JSON data to ensure it's OpenAPI 3.0
    // const validation = await validateOpenApiJson(body);
    // console.log(validation)
    // if (validation.errors.length > 0) {
    //     // If the JSON is invalid, respond with an error
    //     return res.status(400).json({
    //         err: `Invalid OpenAPI 3.0 specification: ${validation.errors.join(', ')}`
    //     });
    // }

    // const validationResult = await validateOpenApiSchema(body);
    // console.log(validationResult)
    // if (validationResult.valid) {
    //   console.log("The input data is a valid OpenAPI 3.0 specification.");
    // } else {
    //     console.error("The input data is NOT valid. Errors:", validationResult.errors);
    //     return res.status(400).json({
    //         err: `Invalid OpenAPI 3.0 specification: ${validationResult.errors}`
    //     });
    // }

    const validationResult = await validateOpenApiSchema(body);
    console.log(validationResult)

    if (!validationResult.valid) {
      return res.status(400).json({
        error: 'Invalid OpenAPI schema',
        details: validationResult.errors[0].message,
      });
    }


    // Convert the OpenAPI schema
    const convertedData = await convertData(body);
    console.log(convertedData)
    const ans = await convertToFlattenedFormat(convertedData);

    return res.status(200).json({ ans });
  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({
      error: `Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
});

app.post('/convert/openapi/test', async (req, res) => {
  try {
    const { input, output, parameters } = req.body;
    console.log('Input:', input);
    console.log('Output:', output);
    console.log('Parameters:', parameters);

    if (!input || !output || !parameters || Object.keys(input).length === 0 || Object.keys(output).length === 0) {
      return res.status(400).json({ error: 'No data provided' });
    }

    const openapiSchema = await generateOpenAPISchema(input, output, parameters);
    console.log('Generated OpenAPI Schema:', JSON.stringify(openapiSchema, null, 2));

    return res.status(200).json({ openapiSchema });

  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({
      error: `Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
});

// Example route to fetch data from Supabase
app.get('/api/test', async (req, res) => {
    
    try {
        
        let { data, error } = await supabase
        .from('users')
        .select('*')
                
    
        if (error) {
          console.error('Supabase Error:', error);
          res.status(500).json({ error: error.message });
        } else {
          console.log('Data:', data);
          res.json(data);
        }
      } catch (err) {
        console.error('Fetch Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }

});

app.get('/api/v1/projects/test', async (req, res) => {
    
    let { data, error } = await supabase
    .from('projects')
    .select('*')
            
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    res.json(data);
});

app.post('/api/v1/projects/test', verifyClerkToken, async (req, res) => {
  
  const { userId } = req.body;

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects' });
  }
  // Fetch projects for the authenticated user from Supabase
  let { data, error } = await supabase
    .from('projects')
    .select("*")
    .eq('user_id', userId);  // Ensure this matches your column in Supabase

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);

});

app.post('/api/v1/project/:projectId/test', async (req, res) => {
  const { userId } = req.body;
  const projectId = req.params.projectId;

  // Validate input parameters
  if (!userId || !projectId) {
    return res.status(400).json({ error: 'Both userId and projectId are required.' });
  }

  console.log(`Fetching project with projectId: ${projectId} and userId: ${userId}`);

  try {
    // Query the database to find the project for the specified user and projectId
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .single();  // Use .single() because we expect only one record

    // Handle errors if any occur during the query
    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: 'An error occurred while retrieving the project. Please try again later.' });
    }

    // If no project is found, return a 404 error
    if (!data) {
      return res.status(404).json({ error: 'Project not found for the given userId and projectId.' });
    }

    // If project is found, return it in the response
    res.status(200).json(data);

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// add new project API
app.post('/api/v1/projects/add/test', verifyClerkToken, async (req, res) => {
  const { project_name, description, userId } = req.body;

  console.log(project_name);
  console.log(description);

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  console.log(req.user.sub)
  console.log(userId)
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects' });
  }

  try {
    // Check if the user exists in the database
    let { data: userData, error: userError } = await supabase
      .from('users') // Assuming you have a table called 'projects'
      .select('user_id') // We only need the id to verify existence
      .eq('user_id', userId)
      .single(); // .single() will return one row, or null if not found

      console.log("userData: ",userData)
      console.log("userError: ", userError)

    if (userError || !userData) {
      return res.status(404).json({ error: 'Project not found', success: false });
    }

    const { data, error } = await supabase
      .from('projects')
      .insert([
        { project_name: project_name, description: description, user_id: userId }
      ])
      .select();

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    } else {
      console.log('Data:', data);
      return res.json(data);
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/v1/project/delete/test', async (req, res) => {
  const { project_id, user_id } = req.body;

  console.log(project_id, user_id)

  // Validate input parameters
  if (!project_id || !user_id) {
    return res.status(400).json({ error: 'Both project_id and user_id are required.' });
  }

  try {
    // Check if the user exists in the users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', user_id)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError || 'No matching user.');
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if the project exists for the specific user
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('project_id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .single();

    if (projectError || !projectData) {
      console.error('Project not found or does not belong to the user:', projectError || 'No matching project.');
      return res.status(404).json({ error: 'Project not found or does not belong to the specified user.' });
    }

    // Proceed to delete the project
    const { data, error } = await supabase
      .from('projects')
      .delete()
      .eq('project_id', project_id)
      .eq('user_id', user_id);

    if (error) {
      console.error('Supabase Error during deletion:', error);
      return res.status(500).json({ error: 'Failed to delete the project. Please try again later.' });
    }

    // If data is null but no error occurred, it means the delete was successful
    if (data === null) {
      console.log('Project successfully deleted.');
      return res.status(200).json({ message: 'Project successfully deleted.' });
    } else {
      // This case should not occur if the validation worked correctly, but we handle it anyway
      return res.status(404).json({ error: 'Project not found or already deleted.' });
    }

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/api/v1/project/update/test', async (req, res) => {
  const { project_id, user_id, project_name, description } = req.body;

  console.log(project_id, user_id, project_name, description)

  // Validate input parameters
  if (!project_id || !user_id || !project_name || !description) {
    return res.status(400).json({ error: 'project_id, user_id, project_name, and description are required.' });
  }

  try {
    // Check if the user exists in the users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', user_id)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError || 'No matching user.');
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if the project exists for the specific user
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('project_id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .single();

    if (projectError || !projectData) {
      console.error('Project not found or does not belong to the user:', projectError || 'No matching project.');
      return res.status(404).json({ error: 'Project not found or does not belong to the specified user.' });
    }

    // Proceed to update the project
    const { data, error } = await supabase
      .from('projects')
      .update({
        project_name: project_name,
        description: description
      })
      .eq('project_id', project_id)
      .eq('user_id', user_id);

    console.log("Updated data: ", data)

    if (error) {
      console.error('Supabase Error during update:', error);
      return res.status(500).json({ error: 'Failed to update the project. Please try again later.' });
    }

    // If data is null but no error occurred, it means the update was successful
    if (data === null) {
      console.log('Project successfully updated.');
      return res.status(200).json({ message: 'Project successfully updated.' });
    } else {
      // This case should not occur if the validation worked correctly, but we handle it anyway
      return res.status(404).json({ error: 'Project not found or already up-to-date.' });
    }

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/v1/documentations/test', async (req, res) => {
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select('*')
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

//  Get documentation by projectID API
app.post('/api/v1/documentations/:projectId/test', verifyClerkToken, async (req, res) => {

  const projectId = req.params.projectId;
  const { userId } = req.body;

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required', success: false });
  }
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects', success: false });
  }

  // Check if the project exists in the database
  let { data: projectData, error: projectError } = await supabase
    .from('projects') // Assuming you have a table called 'projects'
    .select('project_id') // We only need the id to verify existence
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single(); // .single() will return one row, or null if not found

    console.log("projectData: ",projectData)
    console.log("projectError: ", projectError)

  if (projectError || !projectData) {
    return res.status(404).json({ error: 'Project not found', success: false });
  }
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select("*")
  .eq('project_id', projectId)
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  console.log(data);
  console.log(error)

  res.status(200).json({data: data, success: true});
});

app.post('/api/v1/documentation/:docid/test', verifyClerkToken, async (req, res) => {

  const docId = req.params.docid;
  const { project_id } = req.body;

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required', success: false });
  }
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects', success: false });
  }

  // Check if the project exists in the database
  let { data: projectData, error: projectError } = await supabase
    .from('projects') // Assuming you have a table called 'projects'
    .select('project_id') // We only need the id to verify existence
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .single(); // .single() will return one row, or null if not found

    console.log("projectData: ",projectData)
    console.log("projectError: ", projectError)

  if (projectError || !projectData) {
    return res.status(404).json({ error: 'Project not found', success: false });
  }

  // Get the documentation  
  let { data, error } = await supabase
  .from('apidocumentation')
  .select("*")
  .eq('api_id', docId)
  .eq('project_id', project_id)
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// add new documentation API
app.post('/api/v1/documentation/add/test/aaa', verifyClerkToken, async (req, res) => {
  const { userId, project_id, title, description } = req.body;

  console.log(title);
  console.log(description);

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  console.log(req.user.sub)
  console.log(userId)
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects' });
  }

  try {
    // Check if the project exists in the database
    let { data: projectData, error: projectError } = await supabase
      .from('projects') // Assuming you have a table called 'projects'
      .select('project_id') // We only need the id to verify existence
      .eq('project_id', project_id)
      .eq('user_id', userId)
      .single(); // .single() will return one row, or null if not found

      console.log("projectData: ",projectData)
      console.log("projectError: ", projectError)

    if (projectError || !projectData) {
      return res.status(404).json({ error: 'Project not found', success: false });
    }

    const { data, error } = await supabase
      .from('apidocumentation')
      .insert([
        { project_id: project_id, title: title, description: description }
      ])
      .select();

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    } else {
      console.log('Data:', data);
      return res.status(201).json({data: data, success: true});
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/v1/documentation/:docId/schema/test', verifyClerkToken, async (req, res) => {

  const docId = req.params.docId;

  const { userId, project_id } = req.body;

  console.log(project_id)
  console.log(userId)

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  console.log(req.user.sub)
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects' });
  }

  // Check if the project exists in the database
  let { data: projectData, error: projectError } = await supabase
    .from('projects') // Assuming you have a table called 'projects'
    .select('project_id') // We only need the id to verify existence
    .eq('project_id', project_id)
    .eq('user_id', userId)
    .single(); // .single() will return one row, or null if not found

  console.log("projectData: ",projectData)
  console.log("projectError: ", projectError)

  if (projectError || !projectData) {
    return res.status(404).json({ error: 'Project not found', success: false });
  }
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select("*")
  .eq('api_id', docId)
  .eq('project_id', project_id)
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

app.post('/api/v1/documentations/:docId/add/schema/test', async (req, res) => {
  const docId = req.params.docId;
  const apiData = req.body;

  console.log(apiData);

  try {
    
    const { data, error } = await supabase
      .from('apidocumentation')
      .update({ openapi_schema: apiData })
      .eq('api_id', docId)
      .select()
            

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    } else {
      console.log('Data:', data);
      return res.status(201).json(data);
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/v1/documentation/delete/test', async (req, res) => {
  const { user_id, project_id, docId } = req.body;

  console.log("delete data: ", user_id, project_id, docId)

  // Validate input
  if (!project_id || !user_id || !docId) {
    return res.status(400).json({ error: 'docId, project_id, and user_id are required.' });
  }

  try {
    // 1. Validate User
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', user_id)
      .maybeSingle(); // Handles no rows

    if (userError) {
      return res.status(500).json({ error: 'Error fetching user.' });
    }
    if (!userData) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // 2. Validate Project
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('project_id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (projectError) {
      return res.status(500).json({ error: 'Error fetching project.' });
    }
    if (!projectData) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // 3. Check if Documentation Exists
    const { data: docData, error: docError } = await supabase
      .from('apidocumentation')
      .select('api_id')
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .maybeSingle();

    if (docError) {
      return res.status(500).json({ error: 'Error fetching documentation.' });
    }
    if (!docData) {
      return res.status(404).json({ error: 'Documentation not found.' }); // Explicit "not found"
    }

    // 4. Delete Documentation
    const { data: deleteData, error: deleteError } = await supabase
      .from('apidocumentation')
      .delete()
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .select()

    if (deleteError && deleteData.length <= 0) {
      return res.status(500).json({ error: 'Failed to delete documentation.' });
    }

    // Success
    return res.status(200).json({ message: 'Documentation deleted successfully.' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.put('/api/v1/documentation/update/test', async (req, res) => {
  const { docId, project_id, user_id, title, description, openapi_schema, url, input, output } = req.body;

  console.log(docId, project_id, user_id);

  // Validate input parameters
  if (!docId || !project_id || !user_id || !title) {
    return res.status(400).json({ error: 'docId, project_id, user_id, title are required.' });
  }

  try {

    // Validate the openapi_schema
    if (!openapi_schema || Object.keys(openapi_schema).length === 0) {
      return res.status(400).json({ error: 'No data provided' });
    }

    const validationResult = await validateOpenApiSchema(openapi_schema);
    console.log(validationResult)

    if (!validationResult.valid) {
      return res.status(400).json({
        error: 'Invalid OpenAPI schema',
        details: validationResult.errors[0].message,
      });
    }

    // Convert the input openapi_schema to actual OpenAPI schema JSON object
    const convertedData = await convertData(openapi_schema);
    console.log(convertedData)
    const ans = await convertToFlattenedFormat(convertedData);

    // Check if the user exists in the users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', user_id)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError || 'No matching user.');
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if the project exists for the specific user
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('project_id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .single();

    if (projectError || !projectData) {
      console.error('Project not found or does not belong to the user:', projectError || 'No matching project.');
      return res.status(404).json({ error: 'Project not found or does not belong to the specified user.' });
    }

    // 3. Check if Documentation Exists for given Project_Id
    const { data: docData, error: docError } = await supabase
      .from('apidocumentation')
      .select('api_id')
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .maybeSingle();

    if (docError) {
      return res.status(500).json({ error: 'Error fetching documentation.' });
    }
    if (!docData) {
      return res.status(404).json({ error: 'Documentation not found.' }); // Explicit "not found"
    }

    // Proceed to update the project
    const { data, error } = await supabase
      .from('apidocumentation')
      .update({
        title: title,
        description: description,
        openapi_schema: ans,
        url: url,
        input: input,
        output: output
      })
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .select()

    console.log("Updated data: ", data)

    if (error || data.length <= 0) {
      console.error('Supabase Error during update:', error);
      return res.status(500).json({ error: 'Failed to update the API Documentation. Please try again later.' });
    }

    // If data is null but no error occurred, it means the update was successful
    if (data.length > 0) {
      console.log('API documentation successfully updated.');
      return res.status(200).json({ message: 'Project successfully updated.', data: data });
    } else {
      // This case should not occur if the validation worked correctly, but we handle it anyway
      return res.status(404).json({ error: 'API documentation not found or already up-to-date.' });
    }

  } catch (err) {
      console.error('Error processing request:', err);
      return res.status(500).json({
        error: `Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
  }

});

app.put('/api/v1/documentation/update/test', async (req, res) => {
  const {docId, project_id, user_id, title, description, url, openapi_schema, input, output} = req.body;

  // const { data, error } = await supabase
  //     .from('apidocumentation')
  //     .update({
  //       title: title,
  //       description: description,
  //       openapi_schema: openapi_schema,
  //       url: url,
  //       input: input,
  //       output: output
  //     })
  //     .eq('api_id', docId)
  //     .eq('project_id', project_id)
  //     .select()

  const { data: docData, error: docError } = await supabase
      .from('apidocumentation')
      .select('api_id')
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .maybeSingle();

    console.log("Updated data: ", docData)
      console.log(docError)

      if (docError) {
        return res.status(500).json({ error: 'Error fetching documentation.' });
      }
      if (!docData) {
        return res.status(404).json({ error: 'Documentation not found.' }); // Explicit "not found"
      }
    

    res.send(docData)
  
  // const { data, error } = await supabase
  // .from('apidocumentation')
  // .delete()
  // .eq('api_id', docId)
  // .eq('project_id', project_id)
  // .select()

        
});

app.get('/test', async (req, res) => {
  const { url, apikey, Authorization, input } = req.body;

  try {
    const headers = {
      'Content-type': 'application/json',
      'apikey': apikey,
      'Authorization': Authorization,
    };

    const response = await axios.get(url, { headers });
    console.log('Data:', response.data);
    res.json(response.data);

  } catch (error) {
    console.error('Axios Error:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// delete api documentation
app.post('/api/test', verifyClerkToken, async (req, res) => {
  const { user_id, project_id, docId } = req.body;

  console.log("delete data: ", user_id, project_id, docId);

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  console.log(req.user.sub)
  console.log(user_id)
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== user_id) {
    return res.status(403).json({ error: 'You are not authorized to access these projects' });
  }

  // Validate input
  if (!project_id || !user_id || !docId) {
    return res.status(400).json({ error: 'docId, project_id, and user_id are required.' });
  }

  try {
    // 1. Validate User
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', user_id)
      .maybeSingle(); // Handles no rows

    if (userError) {
      return res.status(500).json({ error: 'Error fetching user.' });
    }
    if (!userData) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // 2. Validate Project
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('project_id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (projectError) {
      return res.status(500).json({ error: 'Error fetching project.' });
    }
    if (!projectData) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // 3. Check if Documentation Exists
    const { data: docData, error: docError } = await supabase
      .from('apidocumentation')
      .select('api_id')
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .maybeSingle();

    if (docError) {
      return res.status(500).json({ error: 'Error fetching documentation.' });
    }
    if (!docData) {
      return res.status(404).json({ error: 'Documentation not found.' }); // Explicit "not found"
    }

    // 4. Delete Documentation
    const { data: deleteData, error: deleteError } = await supabase
      .from('apidocumentation')
      .delete()
      .eq('api_id', docId)
      .eq('project_id', project_id)
      .select()

    if (deleteError && deleteData.length <= 0) {
      return res.status(500).json({ error: 'Failed to delete documentation.' });
    }

    // Success
    return res.status(200).json({ message: 'Documentation deleted successfully.' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
})

// add api documentation
// app.post('/api/v1/documentation/add/test', async (req, res) => {
//   const { project_id, title, description } = req.body;

//   console.log(title);
//   console.log(description);

//   try {
//     const { data, error } = await supabase
//       .from('apidocumentation')
//       .insert([
//         { project_id: project_id, title: title, description: description }
//       ])
//       .select();

//     if (error) {
//       console.error('Supabase Error:', error);
//       return res.status(500).json({ error: error.message });
//     } else {
//       console.log('Data:', data);
//       return res.status(201).json(data);
//     }
//   } catch (err) {
//     console.error('Fetch Error:', err);
//     return res.status(500).json({ error: 'Internal Server Error' });
//   }
// });

app.post('/api/project/test/delete/test', async (req, res) => {
  const { project_id, user_id } = req.body;

  console.log(project_id, user_id)

  // Validate input parameters
  if (!project_id || !user_id) {
    return res.status(400).json({ error: 'Both project_id and user_id are required.' });
  }

  try {
    // Check if the user exists in the users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', user_id)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError || 'No matching user.');
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if the project exists for the specific user
    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select('project_id')
      .eq('project_id', project_id)
      .eq('user_id', user_id)
      .single();

    if (projectError || !projectData) {
      console.error('Project not found or does not belong to the user:', projectError || 'No matching project.');
      return res.status(404).json({ error: 'Project not found or does not belong to the specified user.' });
    }

    // Proceed to delete the project
    const { data, error } = await supabase
      .from('projects')
      .delete()
      .eq('project_id', project_id)
      .eq('user_id', user_id);

    if (error) {
      console.error('Supabase Error during deletion:', error);
      return res.status(500).json({ error: 'Failed to delete the project. Please try again later.' });
    }

    // If data is null but no error occurred, it means the delete was successful
    if (data === null) {
      console.log('Project successfully deleted.');
      return res.status(200).json({ message: 'Project successfully deleted.' });
    } else {
      // This case should not occur if the validation worked correctly, but we handle it anyway
      return res.status(404).json({ error: 'Project not found or already deleted.' });
    }

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
})

// Apply the middleware to your routes
app.post('/protected', verifyClerkToken, async(req, res) => {

  // Now that we know the user is authenticated, check if the userId matches
  const { userId } = req.body;

  // 2. Verify user authentication
  if (!req.user || !req.user.sub) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Compare the decoded user ID with the one sent in the request
  if (req.user.sub !== userId) {
    return res.status(403).json({ error: 'You are not authorized to access these projects' });
  }
  // Fetch projects for the authenticated user from Supabase
  let { data, error } = await supabase
    .from('projects')
    .select("*")
    .eq('user_id', userId);  // Ensure this matches your column in Supabase

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
  //res.json({ message: 'Access granted', user: req.user });
});

app.post('/api/v1/documentation/:docId/schema/playground', async (req, res) => {

  const docId = req.params.docId;

  // Check if the project exists in the database
  let { data: projectData, error: projectError } = await supabase
    .from('projects') // Assuming you have a table called 'projects'
    .select('project_id') // We only need the id to verify existence
    .eq('project_id', project_id)
    .eq('user_id', userId)
    .single(); // .single() will return one row, or null if not found

  console.log("projectData: ",projectData)
  console.log("projectError: ", projectError)

  if (projectError || !projectData) {
    return res.status(404).json({ error: 'Project not found', success: false });
  }
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select("*")
  .eq('api_id', docId)
  .eq('project_id', project_id)
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// Start the server
const PORT = process.env.PORT || 8000;
app.listen(PORT, async() => {
  console.log(`Server is running on http://localhost:${PORT}`);
});