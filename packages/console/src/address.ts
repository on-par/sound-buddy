export function normalizeReplyAddress(address: string): string {
  return address.startsWith('/') ? address : '/' + address
}

export function replyAddressMatches(requestAddress: string, replyAddress: string): boolean {
  return normalizeReplyAddress(requestAddress) === normalizeReplyAddress(replyAddress)
}