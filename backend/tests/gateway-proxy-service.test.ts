import { GatewayProxyService } from '../src/services/gateway-proxy-service';

describe('GatewayProxyService response headers', () => {
  it('drops Set-Cookie and hop-by-hop headers while preserving ordinary headers', () => {
    const service = new GatewayProxyService();
    const preserveHeaders = (service as any).preserveHeaders.bind(service);

    expect(preserveHeaders({
      'content-type': 'application/json',
      connection: 'keep-alive',
      'set-cookie': ['session=secret; HttpOnly'],
    })).toEqual({
      'content-type': 'application/json',
    });
  });
});