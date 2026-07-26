---
name: generate-test-from-spec
description: Given an SR row from a spec file, generate concrete test cases covering the main flow and all enumerated exceptions.
---

# Generate Test From Spec

## When to Invoke

- After implementing any SR, before moving to the next SR
- When an SR is expanded or modified
- Building the test suite for a spec file
- Verifying test coverage for implemented code

## What This Skill Does

1. Takes an SR ID as input
2. Reads the SR row and all related exception rows
3. Generates a test case for the main flow
4. Generates a test case for each enumerated SE and BE exception
5. Generates edge case tests based on the SR's inputs and outputs
6. Returns test code in the project's test framework

## Procedure

### Step 1: Read the SR
Read the full SR row from the expanded spec file:
- Main flow row (`---` type)
- All SE rows (`SR_XX_YY_SE-NN`)
- All BE rows (`SR_XX_YY_BE-NN`)

### Step 2: Generate Main Flow Test
Format:
```typescript
describe('SR_XX_YY: {Usecase}', () => {
  it('happy path: {expected output summary}', async () => {
    // Arrange
    const input: {InputFormat} = { /* valid input from Expected Input */ };
    const context = setupContext({ /* required Assets/Cred/Other */ });
    
    // Act
    const result = await {component}.execute(input, context);
    
    // Assert
    expect(result).toMatchFormat('{OutputFormat}');
    expect(result).toMatchExpectedOutput({ /* from Expected Output */ });
    expect(stateMachine.currentState).toBe('{Next Step}');
    
    // Traceability
    // Implements: SR_XX_YY
  });
});
```

### Step 3: Generate Exception Tests
For each SE row:
```typescript
describe('SR_XX_YY_SE-NN: {Exception description}', () => {
  it('handles {exception} gracefully', async () => {
    // Arrange
    const input = { /* valid input */ };
    const context = setupContext({ /* with exception condition */ });
    mockExceptionCondition(); // e.g., mock network failure
    
    // Act
    const result = await {component}.execute(input, context);
    
    // Assert
    expect(result.error).toMatchExceptionFormat('SE-NN');
    expect(retryCount).toBe(expectedRetryCount);
    expect(alertFired).toBe(expected);
    expect(stateMachine.currentState).toBe('{exception Next Step}');
    
    // Traceability
    // Implements: SR_XX_YY_SE-NN
  });
});
```

Similar pattern for BE rows.

### Step 4: Generate Edge Case Tests
Based on SR:
- Empty input
- Max-size input
- Boundary conditions (if applicable)
- Concurrent execution (if concurrency_safe = true)
- Timeout behavior

### Step 5: Return Test Suite
Output complete test file with:
- All tests generated
- Proper imports
- Setup/teardown
- Traceability comments on every test

## Critical Rules

- Every test must reference the SR ID in a comment
- Every SE row must have at least one test
- Every BE row must have at least one test
- Tests must not assume behavior beyond what the SR specifies
- Tests must fail if the implementation deviates from spec
- Do NOT generate tests for code behavior not covered by an SR (that behavior should not exist)

## Output Example

For SR_CONN_01 (connection request):

```typescript
// Tests for SR_CONN_01: Request new connection to enterprise system
// Spec: spec/03-connection-layer-expanded.md

import { ConnectionRequestHandler } from '../src/connection/ConnectionRequestHandler';
import { mockCaaS, mockGovernance } from '../test-utils';

describe('SR_CONN_01: Request new connection to enterprise system', () => {
  it('creates a pending Connection node on valid request', async () => {
    // Arrange
    const request = {
      system: 'SAP',
      authType: 'oauth2',
      purpose: 'Q1 invoice data for AP dashboard',
      requestedBy: 'user-123',
    };
    const caas = mockCaaS({ healthy: true });
    const governance = mockGovernance({ approvalRequired: true });
    
    // Act
    const result = await ConnectionRequestHandler.handle(request, { caas, governance });
    
    // Assert
    expect(result.state).toBe('REQUESTED');
    expect(result.tenantId).toBeDefined();
    expect(governance.approvalChain).toHaveBeenInvoked();
    
    // Traceability
    // Implements: SR_CONN_01
  });
});

describe('SR_CONN_01_SE-01: CaaS unavailable during credential storage', () => {
  it('retries 3 times then escalates to admin', async () => {
    // Arrange
    const request = { /* valid */ };
    const caas = mockCaaS({ healthy: false, failureMode: 'network' });
    
    // Act
    const result = await ConnectionRequestHandler.handle(request, { caas });
    
    // Assert
    expect(caas.callCount).toBe(3);
    expect(result.error.code).toBe('SE-01');
    expect(adminAlerts.length).toBe(1);
    
    // Traceability
    // Implements: SR_CONN_01_SE-01
  });
});

describe('SR_CONN_01_BE-01: User lacks permission', () => {
  it('rejects request with clear explanation', async () => {
    // Arrange
    const request = { requestedBy: 'user-with-no-permission' };
    const governance = mockGovernance({ denyAll: true });
    
    // Act
    const result = await ConnectionRequestHandler.handle(request, { governance });
    
    // Assert
    expect(result.error.code).toBe('BE-01');
    expect(result.error.message).toContain('insufficient permissions');
    expect(result.error.remediation).toBeDefined();
    
    // Traceability
    // Implements: SR_CONN_01_BE-01
  });
});
```

## Integration

Invoke this skill after implementing each SR. Tests are placed in a mirror directory structure of the implementation. Tests are part of the CI pipeline.
