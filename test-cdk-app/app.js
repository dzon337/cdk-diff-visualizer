const cdk = require('aws-cdk-lib');
const s3 = require('aws-cdk-lib/aws-s3');
const sqs = require('aws-cdk-lib/aws-sqs');
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');

const app = new cdk.App();
const stack = new cdk.Stack(app, 'CdkDiffReportTestStack', {
  // Pull account/region from your local AWS profile
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:  process.env.CDK_DEFAULT_REGION,
  },
});

// S3 bucket
const bucket = new s3.Bucket(stack, 'TestBucket', {
  bucketName: undefined, // auto-generated name
  versioned: true,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// SQS queue
const queue = new sqs.Queue(stack, 'TestQueue', {
  visibilityTimeout: cdk.Duration.seconds(30),
});

// Lambda function
const fn = new lambda.Function(stack, 'TestFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromInline(`
    exports.handler = async (event) => {
      return { statusCode: 200, body: 'hello from test lambda' };
    };
  `),
  environment: {
    QUEUE_URL: queue.queueUrl,
  },
});

// IAM — gives cdk diff something interesting to show in the IAM section
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject'],
  resources: [bucket.bucketArn + '/*'],
}));

bucket.grantRead(fn);
