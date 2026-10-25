import { describe, expect, it, vi } from 'vitest';
import {
  FLEX_BASE_URL, buildFetchUrl, buildSendRequestUrl, fetchIbkrFlexPositions, parseFlexPositions,
  parseSendResponse,
} from './ibkr-flex.mjs';

// 全部用假数据：真 token 由用户自己填，代码里不出现
const SEND_OK = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="25 October, 2026 10:00 AM EDT">
<Status>Success</Status>
<ReferenceCode>1234567890</ReferenceCode>
<Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>
</FlexStatementResponse>`;

const SEND_FAIL = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="25 October, 2026 10:00 AM EDT">
<Status>Fail</Status>
<ErrorCode>1012</ErrorCode>
<ErrorMessage>Token has expired.</ErrorMessage>
</FlexStatementResponse>`;

const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="positions" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20261024" toDate="20261024" period="LastBusinessDay" whenGenerated="20261025;100000">
<OpenPositions>
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="QQQM" position="40" markPrice="298.64" costBasisPrice="280.12" reportDate="20261024" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="TQQQ" position="215" markPrice="72.61" costBasisPrice="60.5" reportDate="20261024" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="OPT" symbol="NVDA  261218C00250000" position="2" markPrice="5.4" costBasisPrice="7.1" reportDate="20261024" underlyingSymbol="NVDA" multiplier="100" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="ZERO" position="0" markPrice="10" costBasisPrice="10" reportDate="20261024" />
</OpenPositions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const IN_PROGRESS = `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`;

describe('IBKR Flex 网络服务的两步流程', () => {
  it('第一步的地址带 token、查询号和版本', () => {
    expect(buildSendRequestUrl('TOKEN_PLACEHOLDER', '999')).toBe(
      `${FLEX_BASE_URL}/SendRequest?t=TOKEN_PLACEHOLDER&q=999&v=3`,
    );
    expect(FLEX_BASE_URL).toContain('ndcdyn.interactivebrokers.com');
  });

  it('解析第一步的返回：成功给出取件码和地址', () => {
    expect(parseSendResponse(SEND_OK)).toEqual({
      ok: true,
      referenceCode: '1234567890',
      url: 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement',
    });
  });

  it('token 过期这类错误照实返回，不抛裸异常', () => {
    expect(parseSendResponse(SEND_FAIL)).toEqual({
      ok: false, errorCode: '1012', errorMessage: 'Token has expired.',
    });
    expect(parseSendResponse('不是 XML')).toMatchObject({ ok: false });
  });

  it('第二步的地址用取件码换报表', () => {
    expect(buildFetchUrl('https://x/GetStatement', '1234567890', 'TOKEN_PLACEHOLDER'))
      .toBe('https://x/GetStatement?q=1234567890&t=TOKEN_PLACEHOLDER&v=3');
  });
});

describe('解析持仓报表', () => {
  it('股票和期权都解析出来，数量为 0 的丢掉', () => {
    const parsed = parseFlexPositions(REPORT);

    expect(parsed.accountId).toBe('U1234567');
    expect(parsed.asOf).toBe('2026-10-24');
    expect(parsed.positions).toHaveLength(3);
    expect(parsed.positions[0]).toMatchObject({
      symbol: 'QQQM', qty: 40, price: 298.64, costPrice: 280.12, assetType: 'stock', currency: 'USD',
    });
    expect(parsed.positions[2]).toMatchObject({
      symbol: 'NVDA  261218C00250000', qty: 2, assetType: 'option', underlying: 'NVDA', multiplier: 100,
    });
  });

  it('报表还没生成好时能认出来', () => {
    expect(parseFlexPositions(IN_PROGRESS)).toMatchObject({ pending: true });
  });

  it('空报表不报错，返回空持仓', () => {
    expect(parseFlexPositions('<FlexQueryResponse></FlexQueryResponse>').positions).toEqual([]);
  });
});

describe('完整取数（用假的网络层）', () => {
  it('两步走通，报表没生成好会重试', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(SEND_OK)
      .mockResolvedValueOnce(IN_PROGRESS)
      .mockResolvedValueOnce(REPORT);
    const sleep = vi.fn(async () => {});

    const result = await fetchIbkrFlexPositions({
      token: 'TOKEN_PLACEHOLDER', queryId: '999', get, sleep,
    });

    expect(result.ok).toBe(true);
    expect(result.positions).toHaveLength(3);
    expect(get).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('没填 token 时直接说清楚，不去打接口', async () => {
    const get = vi.fn();
    const result = await fetchIbkrFlexPositions({ token: '', queryId: '999', get });

    expect(result).toMatchObject({ ok: false, reason: 'missing_token' });
    expect(get).not.toHaveBeenCalled();
  });

  it('token 过期时把 IBKR 给的原话带出来', async () => {
    const get = vi.fn().mockResolvedValue(SEND_FAIL);
    const result = await fetchIbkrFlexPositions({ token: 'X', queryId: '999', get });

    expect(result).toMatchObject({ ok: false, reason: 'flex_error', errorCode: '1012' });
    expect(result.errorMessage).toContain('expired');
  });

  it('一直说在生成就放弃，不死等', async () => {
    const get = vi.fn().mockResolvedValueOnce(SEND_OK).mockResolvedValue(IN_PROGRESS);
    const result = await fetchIbkrFlexPositions({
      token: 'X', queryId: '999', get, sleep: async () => {}, maxAttempts: 3,
    });

    expect(result).toMatchObject({ ok: false, reason: 'not_ready' });
  });
});
