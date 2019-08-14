import { expect, haveResource } from '@aws-cdk/assert';
import { Connections, Peer, SubnetType, Vpc } from '@aws-cdk/aws-ec2';
import { Duration, Stack } from '@aws-cdk/core';
import { Test } from 'nodeunit';
import { ILoadBalancerTarget, LoadBalancer, LoadBalancingProtocol } from '../lib';

export = {
  'test specifying nonstandard port works'(test: Test) {
    const stack = new Stack(undefined, undefined, { env: { account: '1234', region: 'test' }});
    stack.node.setContext('availability-zones:1234:test', ['test-1a', 'test-1b']);
    const vpc = new Vpc(stack, 'VCP');

    const lb = new LoadBalancer(stack, 'LB', { vpc });

    lb.addListener({
      externalProtocol: LoadBalancingProtocol.HTTP,
      externalPort: 8080,
      internalProtocol: LoadBalancingProtocol.HTTP,
      internalPort: 8080,
    });

    expect(stack).to(haveResource("AWS::ElasticLoadBalancing::LoadBalancer", {
      Listeners: [{
        InstancePort: "8080",
        InstanceProtocol: "http",
        LoadBalancerPort: "8080",
        Protocol: "http"
      }]
    }));

    test.done();
  },

  'add a health check'(test: Test) {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VCP');

    // WHEN
    new LoadBalancer(stack, 'LB', {
      vpc,
      healthCheck: {
        interval: Duration.minutes(1),
        path: '/ping',
        protocol: LoadBalancingProtocol.HTTPS,
        port: 443,
      }
    });

    // THEN
    expect(stack).to(haveResource("AWS::ElasticLoadBalancing::LoadBalancer", {
      HealthCheck: {
        HealthyThreshold: "2",
        Interval: "60",
        Target: "HTTPS:443/ping",
        Timeout: "5",
        UnhealthyThreshold: "5"
      },
    }));

    test.done();
  },

  'add a listener and load balancing target'(test: Test) {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VCP');
    const elb = new LoadBalancer(stack, 'LB', {
      vpc,
      healthCheck: {
        interval: Duration.minutes(1),
        path: '/ping',
        protocol: LoadBalancingProtocol.HTTPS,
        port: 443,
      }
    });

    // WHEN
    elb.addListener({ externalPort: 80, internalPort: 8080 });
    elb.addTarget(new FakeTarget());

    // THEN: at the very least it added a security group rule for the backend
    expect(stack).to(haveResource('AWS::EC2::SecurityGroup', {
      SecurityGroupEgress: [
        {
          Description: 'Port 8080 LB to fleet',
          CidrIp: "666.666.666.666/666",
          FromPort: 8080,
          IpProtocol: "tcp",
          ToPort: 8080
        }
      ],
    }));

    test.done();
  },

  'enable cross zone load balancing'(test: Test) {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VCP');

    // WHEN
    new LoadBalancer(stack, 'LB', {
      vpc,
      crossZone: true,
    });

    // THEN
    expect(stack).to(haveResource('AWS::ElasticLoadBalancing::LoadBalancer', {
      CrossZone: true
    }));

    test.done();
  },

  'disable cross zone load balancing'(test: Test) {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VCP');

    // WHEN
    new LoadBalancer(stack, 'LB', {
      vpc,
      crossZone: false,
    });

    // THEN
    expect(stack).to(haveResource('AWS::ElasticLoadBalancing::LoadBalancer', {
      CrossZone: false
    }));

    test.done();
  },

  'cross zone load balancing enabled by default'(test: Test) {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VCP');

    // WHEN
    new LoadBalancer(stack, 'LB', {
      vpc,
    });

    // THEN
    expect(stack).to(haveResource('AWS::ElasticLoadBalancing::LoadBalancer', {
      CrossZone: true
    }));

    test.done();
  },

  'use specified subnet'(test: Test) {
    // GIVEN
    const stack = new Stack();
    const vpc = new Vpc(stack, 'VCP', {
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 21
        },
        {
          name: 'private1',
          subnetType: SubnetType.PRIVATE,
          cidrMask: 21
        },
        {
          name: 'private2',
          subnetType: SubnetType.PRIVATE,
          cidrMask: 21
        }
      ],
    });

    // WHEN
    new LoadBalancer(stack, 'LB', {
      vpc,
      subnetSelection: {
        subnetName: 'private1'
      },
    });

    // THEN
    expect(stack).to(haveResource('AWS::ElasticLoadBalancing::LoadBalancer', {
      Subnets: vpc.selectSubnets({
        subnetName: 'private1'
      }).subnetIds.map((subnetId: string) => stack.resolve(subnetId))
    }));

    test.done();
  }

};

class FakeTarget implements ILoadBalancerTarget {
  public readonly connections = new Connections({
    peer: Peer.ipv4('666.666.666.666/666')
  });

  public attachToClassicLB(_loadBalancer: LoadBalancer): void {
    // Nothing to do. Normally we set a property on ourselves so
    // our instances know to bind to the LB on startup.
  }
}
